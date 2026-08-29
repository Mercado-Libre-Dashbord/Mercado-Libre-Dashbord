# 07 · Estado y roadmap

Foto del proyecto al **29 de agosto de 2026**. Si trabajás en algo de acá,
actualizá esta tabla en el mismo PR.

## Qué está terminado y en producción

| Área | Estado |
|---|---|
| Conexión OAuth con Mercado Libre | ✅ En producción con un cliente real |
| Sincronización de publicaciones, órdenes, envíos, publicidad y facturación | ✅ Por lotes y versionada |
| Cálculo de ganancia neta (comisión + envío + ads + costo + IVA + otros impuestos) | ✅ Con tests |
| Panel de Resumen: 8 indicadores, 3 gráficos, tablas | ✅ |
| Selector de período unificado | ✅ `lib/period.ts`, compartido por 3 pantallas |
| Productos: costos con historial, margen, edición de precio en ML | ✅ |
| Consultas: borradores por reglas, envío manual | ✅ |
| Campañas: Mercado Ads + carga de publicidad externa | ✅ Ventanas de 90 días |
| Tendencias por velocidad de venta | ✅ |
| Configuración de otros impuestos a nivel cuenta | ✅ |
| Aislamiento por cuenta con RLS | ✅ Probado con dos cuentas reales |
| Degradación cuando falta una migración | ✅ |
| Multi-cuenta con panel de admin | ✅ |

## En curso / bloqueado

### Logo de MetricsField
**Bloqueado por:** el archivo lo tiene que subir una persona; los bytes de la
imagen no llegan al entorno de desarrollo automático.
**Qué falta:** subir el archivo a `public/logo.png` (o `.svg`/`.webp`/`.jpg`).
El sidebar ya prueba las cuatro extensiones y cae en el monograma si no
encuentra ninguna. Instrucciones paso a paso en `public/README-logo.md`.

### Migraciones de base pendientes
| Archivo | Estado |
|---|---|
| `001-tax.sql` … `007-facturacion.sql` | Corridas (conviene reconfirmar 003 a 006) |
| **`008-canales.sql`** | ⏳ Pendiente — base multicanal |
| `009-loyalty.sql` | Corrida |

Para verificar qué falta: entrar como admin al Resumen; si falta alguna, aparece
un banner con el SQL exacto.

### Tienda Nube
**Estado:** el adaptador está escrito y testeado (`channels/tiendanube.ts`, 7
tests). Falta la conexión.

**Qué hace falta de la persona dueña del producto:**
1. Registrarse como Partner en Tienda Nube.
2. Crear una app en el panel de partners.
3. Configurar como redirect URL: `https://retail.metricsfield.com/api/tiendanube/callback`
4. Pedir los scopes `read_products`, `read_orders`, `read_customers`.
5. Pasar **App ID** y **Client Secret** para cargarlos como
   `TIENDANUBE_CLIENT_ID` y `TIENDANUBE_CLIENT_SECRET` en Vercel.
6. Definir un mail de contacto para el `User-Agent` (hoy figura
   `soporte@metricsfield.com`).

**Qué hace falta del lado del código:**
- `GET /api/tiendanube/login` y `GET /api/tiendanube/callback` (el código de
  autorización vale 5 minutos).
- Guardar la conexión en `channel_connections` (requiere la migración 008).
- Enchufar el adaptador al `sync-service` y que el panel pueda filtrar por canal.

### Facturación (ARCA)
**Estado: en pausa por decisión del dueño del producto**, mientras se investiga
cómo lo resuelven otros.

Construido: el núcleo fiscal puro con 11 tests, la tabla `invoices`, la interfaz
`InvoiceProvider`.

Falta: la conexión WSAA/WSFEv1 con AFIP, los datos fiscales del comprador desde
`/orders/{id}/billing_info`, las notas de crédito (RG 4540/2019), el PDF del
comprobante y la subida del comprobante a Mercado Libre.

**Se necesita de la persona dueña del producto:** certificado digital, punto de
venta habilitado para "Web Services", CUIT y condición fiscal.

**Tres advertencias que hay que resolver antes de escribir una línea más:**
1. **Custodia de claves privadas.** Guardar el certificado fiscal de un tercero
   en un SaaS multi-cliente es una responsabilidad legal seria, no un problema
   de cifrado. Hay que decidir si la asumimos o si delegamos en un proveedor
   habilitado.
2. **Arrancar en el entorno de homologación de ARCA**, nunca directo contra
   producción.
3. **La opción de excluir el envío de la base imponible tiene que venir apagada
   por defecto**, con una advertencia explícita. Presentarla como "optimización
   tributaria" es venderle al cliente un riesgo fiscal como si fuera una función.
4. Desde el **1/9/2026** la condición de IVA del comprador es obligatoria en el
   comprobante. Ya está modelado (`buyer_iva_condition`), pero hay que traer el
   dato real.

### Fidelización, fase 2
Fase 1 está construida (ver [05](05-fidelizacion-y-reviews.md)). Falta:
- **Pantalla de miembros y estadísticas.** Es lo primero que va a pedir el
  cliente: cuántos miembros, cuántas misiones cumplidas, cuántos cupones.
- **Medición del retorno**: cuánta facturación vino de compradores con cupón.
- **Autenticación de `POST /api/loyalty/members`** para cuando la billetera sea
  un servicio externo (probablemente una API key por cuenta).
- **Verificación de misiones**, hoy sistema de honor.

La app de billetera (QR, tarjeta, pantalla de misiones) se desarrolla en otro
proyecto; la costura entre ambos ya está construida y testeada de este lado.

### Conciliación con la facturación de Mercado Libre
Los cargos reales de ML se muestran al lado de nuestra estimación, pero **no
entran en la ganancia neta**. Está esperando que el cliente valide que los
números cierran. Las opciones cuando eso pase: dejarlo como auditoría, o
reemplazar la estimación por orden con el cargo real (más exacto, pero llega con
un mes de retraso).

### Antes de cobrarle a alguien
- **Migrar a Vercel Pro.** El plan Hobby es para uso no comercial. Ver
  [02 · Modelo de negocio](02-modelo-de-negocio.md#costos-qué-nos-cuesta-atender-un-cliente).
- Definir precio y estructura de planes.
- Revisar el plan de Supabase.

## Ideas evaluadas y descartadas (por ahora)

Guardadas para no volver a discutirlas desde cero:

| Idea | Por qué no |
|---|---|
| Integración por API con Meta / Google / TikTok Ads | Complejidad alta y, sin datos de atribución, el gasto igual no se puede prorratear por producto. La carga manual da el mismo valor. |
| Respuestas a consultas generadas con un modelo de lenguaje | Las reglas por palabra clave cubren la mayoría de las preguntas con cero costo y cero latencia. Se puede revisar si aparecen preguntas que no cubren. |
| Donut de categorías más vendidas | Duplicaba la información del gráfico de barras que tenía al lado. |
| Impuestos configurables por producto | Se reemplazó por una alícuota única a nivel cuenta: menos trabajo de carga y menos formas de equivocarse. |
| Pestaña "Resultado del día" | El Resumen ya abre en "hoy". |
| Sección "Última venta" | Un solo dato no justificaba una sección. |

## Cómo elegir en qué trabajar

Por orden de impacto, hoy:

1. **Migración 008 + OAuth de Tienda Nube.** Desbloquea el segundo canal, que
   es la mitad de la promesa del producto y la principal mitigación al riesgo de
   depender de una sola API.
2. **Pantalla de miembros de fidelización.** El módulo diferenciador está a
   ciegas para el vendedor.
3. **Lo necesario para cobrar** (Vercel Pro, precio, planes).
4. **ARCA**, cuando se levante la pausa.

Antes de empezar, leé el documento del área y corré `npx vitest run` para
partir de una base verde.
