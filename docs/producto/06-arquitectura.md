# 06 · Arquitectura

Para quien va a escribir código. Explica **por qué** está armado así, no solo
cómo: las decisiones raras casi siempre son la cicatriz de un bug real.

## Stack

| Capa | Qué usamos |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript |
| Hosting | Vercel — producción en `retail.metricsfield.com` |
| Base de datos | Postgres en Supabase, con **Row Level Security** |
| Autenticación del cliente | NextAuth con Google |
| Conexión a Mercado Libre | OAuth 2, tokens guardados por cuenta |
| Gráficos | Recharts |
| Tests | Vitest |
| Estilo | CSS propio en `app/globals.css`. Monocromo, Montserrat, tema claro. |

## Mapa del repositorio

```
app/                Next.js: pantallas y rutas de API
  api/              summary, products, orders, sync, campaigns, questions,
                    billing, loyalty, ml/*, admin/*
lib/                Dominio puro, sin red ni base: period, iva, order-status,
                    invoicing, loyalty, auth-options, current-account
mcp/                Cliente de la API de Mercado Libre (tools.ts es el grueso)
sync/               Orquestación de la sincronización y cálculo de rentabilidad
channels/           Abstracción multicanal (tipos + adaptador de Tienda Nube)
db/                 Acceso a Postgres, esquema y migraciones
docs/producto/      Esta documentación
```

**La regla de dependencias:** `lib/` no importa nada de `db/`, `mcp/` ni `app/`.
Es dominio puro y por eso es donde están los tests más valiosos: la lógica
fiscal (`iva.ts`, `invoicing.ts`) y las reglas de fidelización (`loyalty.ts`) se
testean sin levantar nada.

## Seguridad: RLS

La app **no** se conecta a Postgres como `postgres` ni con la `service_role` de
Supabase: **las dos ignoran RLS por diseño**, y con cualquiera de ellas las
políticas de seguridad serían decorativas.

Se conecta con un rol común llamado `app_user`, sin privilegios especiales. Cada
query pasa sí o sí por las políticas.

Cómo funciona en cada request:

```
withScope({ accountId }) →  BEGIN
                            SET LOCAL app.current_account_id = '...'
                            SET LOCAL app.is_admin = ...
                            SET LOCAL app.current_user_email = '...'
                            (la query)
                            COMMIT
```

Cada tabla de datos tiene una política `account_id = app_current_account_id()`.
`accounts` tiene la suya: un admin ve todas, un cliente solo la suya por mail.

**Esto es una segunda capa, no un reemplazo del `WHERE account_id` del código.**
Si mañana una ruta nueva se olvida el filtro, Postgres igual no devuelve filas
ajenas. Está probado en `db/rls-isolation.test.ts` con dos cuentas reales,
incluyendo una query deliberadamente escrita sin `WHERE account_id`.

## Degradación por capacidades de esquema

`db/schema-capabilities.ts` consulta `information_schema.columns` (con caché de
60 segundos) para saber qué columnas existen realmente en la base.

**Por qué existe.** Las migraciones las corre el dueño de la cuenta a mano en el
SQL Editor de Supabase. Es inevitable que en algún momento haya una diferencia
entre el código desplegado y el esquema real. Antes de esto, esa diferencia se
manifestaba como **errores 500 en producción** (`column "tax" does not exist`) y
pantallas en blanco: el cliente veía la app rota sin ninguna pista de por qué.

**Qué hace ahora.** Cada query pregunta si la columna existe y, si no, usa un
valor por defecto en su lugar. La app funciona con menos información en vez de
caerse. Y el admin —solo el admin— ve un banner con el archivo SQL exacto que
falta correr.

Al agregar una migración: sumá sus columnas a `EXPECTED_COLUMNS` en ese archivo,
o el banner no la va a detectar.

> **Trampa de Supabase que causó horas de confusión:** el SQL Editor corre todo
> lo pegado como **una sola transacción**. Si una sentencia falla, se revierte
> todo — incluidas las que ya habían funcionado — y el resultado puede parecer
> exitoso. Por eso las migraciones son archivos separados, idempotentes, y cada
> una termina con un `SELECT` de verificación que dice cuántas filas tiene que
> devolver.

## Sincronización

Vive en `sync/sync-service.ts`, expuesta en `app/api/sync/route.ts`.

### Por lotes, porque la función se moría

Una sincronización histórica completa tarda más que el límite de una función
serverless en Vercel (60 segundos en el plan Hobby). El síntoma era
`/api/sync` devolviendo **status 0** — la conexión cortada, sin error útil.

Solución: el cliente llama `POST /api/sync { offset }` en un bucle, procesando
**50 órdenes por lote**, mostrando el progreso, con un tope de seguridad de 500
iteraciones. `maxDuration = 60`.

### Versionado, para poder reparar el pasado

`orders.sync_version` + la constante `ORDER_SYNC_VERSION`.

El problema: la sincronización arrancaba desde `MAX(date_created)`, así que
cuando arreglamos el cálculo del envío, la corrección **nunca podía llegar a las
órdenes ya sincronizadas**. Los datos viejos quedaban mal para siempre.

Ahora un solo botón recorre toda la historia pero **saltea las órdenes que ya
están en la versión actual**. Cuando cambiamos una fórmula, subimos
`ORDER_SYNC_VERSION` y la próxima sincronización repara los datos viejos sola.

**Si cambiás cómo se calcula algo en `order_items`, subí esa constante.** Es la
única forma de que la corrección llegue a los datos existentes.

### Fases

`runSync` orquesta, y cada fase se exporta por separado para poder testearla:
`syncProducts` → `pendingOrderIds` → `syncOrders` → `syncAds` → `recalculate` →
`syncBillingCharges`.

## Multicanal

`channels/types.ts` define el contrato `SalesChannel` que tiene que cumplir
cualquier canal de venta: `listProducts`, `listOrdersPage`, `getOrder`. Los
estados se normalizan a `paid | pending | cancelled` y el envío llega **ya
prorrateado por línea**, así que todo lo particular de cada API queda del lado
del adaptador y el sync no se entera.

`products.channel` y `orders.channel` tienen default `'mercado_libre'`: todo lo
ya sincronizado queda correctamente etiquetado sin resincronizar nada.

`channels/tiendanube.ts` implementa el contrato (7 tests). Particularidades que
cuestan encontrar en la documentación de Tienda Nube:

- El header de autenticación es **`Authentication: bearer`**, no `Authorization`.
- El `User-Agent` es **obligatorio** y tiene que identificar la app con un mail
  de contacto.
- Los tokens **no expiran** y no hay refresh — por eso `channel_connections`
  tiene `refresh_token` y `expires_at` opcionales.
- El código de autorización del OAuth vale solo **5 minutos**.

**Lo que falta:** el flujo de OAuth (`/api/tiendanube/callback`) y enchufar el
adaptador al sync. Ver [07 · Roadmap](07-estado-y-roadmap.md#tienda-nube).

## Facturación (ARCA)

`lib/invoicing.ts` es el **núcleo fiscal puro**, deliberadamente separado de
cualquier llamada de red (11 tests):

- `resolveInvoiceType(vendedor, comprador)` — decide A, B o C. **Nunca emite una
  A sin CUIT.**
- `calculateInvoiceAmounts(total, tipo)` — siempre va de total a neto, nunca al
  revés. Ir al revés genera diferencias de centavos que después no cierran.
- `prepareInvoice(input)` — arma el borrador completo.
- `InvoiceProvider` — la interfaz que va a implementar el proveedor real.

La tabla `invoices` tiene PK `(account_id, order_id)`: una orden, un
comprobante.

**Lo que falta:** la conexión con AFIP/ARCA (WSAA para el token, WSFEv1 para
pedir el CAE), los datos fiscales del comprador, las notas de crédito y el PDF.
Está **en pausa** por decisión del dueño del producto.

## Testing

```bash
npx vitest run
```

**173 tests pasan sin base de datos.** Otros 15 necesitan un Postgres real
(`db/`, `sync/sync-service`) y fallan con `ECONNREFUSED 127.0.0.1:5432` si no lo
tenés levantado — eso es esperado en local, no un test roto. Para correrlos, ver
la sección de tests del [README raíz](../../README.md).

Los 173 son el contrato de lo que ya funciona: **si tu cambio los rompe, el
cambio está mal o el contrato cambió a propósito** — y en ese caso el test se
actualiza en el mismo commit, explicando por qué.

## Convenciones

- **Todo el texto de cara al cliente va en castellano rioplatense**, en segunda
  persona ("cargá", "fijate"), sin jerga técnica. La app la usa un vendedor, no
  un contador ni un programador.
- **Los comentarios explican el porqué, no el qué.** Un comentario que dice lo
  que la línea ya dice es ruido; uno que dice por qué esa línea es rara vale oro.
- **Gráficos**: monocromo con una serie protagonista en negro y el contexto en
  gris. Nada de arcoíris. Torta solo para partes de un total y con 6 porciones
  como máximo.
- **Ningún número sin explicación**: si agregás una tarjeta al panel, agregale
  su ⓘ con la fórmula.
