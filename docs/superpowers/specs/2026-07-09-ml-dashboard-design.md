# Dashboard de Rentabilidad — Mercado Libre (vía MCP)

## Contexto y objetivo

El dueño de una cuenta de Mercado Libre (Argentina, ~25 productos activos) necesita
una herramienta que le muestre, en un solo lugar, la rentabilidad real de su negocio:
ventas, comisiones, envío y publicidad que ya cobra/descuenta Mercado Libre, más el
costo real de cada producto que él carga manualmente. El objetivo es tomar mejores
decisiones entendiendo el margen real por producto y de la cuenta en general, no solo
la facturación bruta.

## Alcance

Herramienta de uso personal, local (no se hostea en la nube). Todas las funciones
descritas abajo entran en el v1 — lo que se simplifica es la arquitectura (un solo
proyecto), no las funciones.

Fuera de alcance para v1:
- Multi-usuario / multi-cuenta de Mercado Libre
- Hosting remoto o acceso desde otros dispositivos
- Edición o cancelación de publicaciones/órdenes desde el dashboard (es de solo
  lectura respecto a Mercado Libre, salvo la carga de costos propios)

## Arquitectura

Un solo proyecto Next.js que corre localmente (`npm run dev`). El acceso a la API de
Mercado Libre se implementa como un servidor MCP real (usando el SDK oficial de MCP),
expuesto en una ruta interna de la misma app. Esto cumple el requisito de "conectado
vía MCP" y deja la puerta abierta a conectar el mismo servidor a Claude Desktop en el
futuro, sin agregar un proceso ni un repo separado para el v1.

```
ml-dashboard/
  ├─ mcp/              → herramientas MCP: list_products, list_orders,
  │                       get_order_detail, get_ads_spend, refresh_token
  │                       (hablan con api.mercadolibre.com; manejan OAuth y refresh)
  ├─ db/                → SQLite local (better-sqlite3) + esquema y migraciones
  ├─ sync/              → orquesta la sincronización y el cálculo de rentabilidad
  └─ app/                → páginas Next.js (UI)
```

Justificación de la simplificación: se evaluaron tres formas de integrar MCP (servidor
separado y reusable / embebido en la misma app / sin MCP real). Se eligió "embebido"
porque el usuario priorizó velocidad de armado; sigue siendo un servidor MCP legítimo,
solo que corre en el mismo proceso que la app en vez de en un proyecto aparte.

## Autenticación

La app de Mercado Libre Developers ya existe (Client ID/Secret provistos por el
usuario). Flujo OAuth estándar de Mercado Libre:
1. Pantalla/endpoint de autorización que redirige al consent screen de ML.
2. Callback que intercambia el `code` por `access_token` + `refresh_token`.
3. Tokens se guardan en SQLite local (`auth_tokens`), no en el repo ni en variables
   versionadas. `.env` y la base SQLite quedan en `.gitignore`.
4. Las herramientas MCP refrescan el `access_token` automáticamente cuando vence
   (los tokens de ML expiran a las 6 horas) usando el `refresh_token` guardado.

## Modelo de datos (SQLite)

- **products**: `id` (ML item id), `title`, `sku`, `current_price`, `stock`,
  `permalink`, `updated_at`
- **product_costs**: `id`, `product_id`, `cost`, `valid_from` (timestamp) —
  histórico versionado. El costo vigente para un producto es el registro con
  `valid_from` más reciente que sea `<=` a la fecha de la venta que se está
  calculando. Nunca se sobrescribe: cargar un costo nuevo inserta una fila nueva.
- **orders**: `id` (ML order id), `date_created`, `status`, `buyer_total`
- **order_items**: `id`, `order_id`, `product_id`, `unit_price`, `quantity`,
  `ml_commission`, `shipping_cost`, `ads_cost_allocated`, `cost_applied`
  (snapshot del costo vigente al momento del sync), `net_profit` (calculado y
  persistido en el momento de sincronizar, no en cada render)
- **ads_spend**: `id`, `product_id`, `date`, `amount` — gasto diario de Mercado Ads
  por producto, tal como lo reporta la API de Ads
- **auth_tokens**: `access_token`, `refresh_token`, `expires_at`

## Sincronización y cálculo

Botón manual "Sincronizar" en la UI (sin cron en background para el v1, mantiene el
flujo simple de razonar y debuggear). Al sincronizar:

1. Trae/actualiza `products` (listado + detalle de precio y stock).
2. Trae órdenes nuevas o modificadas desde el último sync (`orders` + `order_items`),
   incluyendo comisión y costo de envío que ya vienen en el detalle de la orden de ML.
3. Trae `ads_spend` diario por producto desde la API de Mercado Ads.
4. Para cada `order_item` nuevo: busca el costo vigente en `product_costs` a la fecha
   de la orden, prorratea el `ads_spend` del día entre las unidades vendidas ese día
   para ese producto, y calcula `net_profit = unit_price*quantity - ml_commission -
   shipping_cost - ads_cost_allocated - cost_applied*quantity`. El resultado se
   guarda, no se recalcula en cada carga de pantalla.
5. Si un producto no tiene ningún costo cargado en `product_costs`, sus
   `order_items` quedan con `cost_applied = NULL` y se excluyen del cálculo de
   rentabilidad neta de la cuenta (se muestran aparte, marcados como "costo
   pendiente de cargar") — nunca se asume costo $0.

Cuando el usuario carga o edita un costo en la UI, se inserta una fila nueva en
`product_costs` con `valid_from = ahora`. Las ventas pasadas conservan el
`cost_applied` que ya tenían; solo las sincronizaciones futuras usan el costo nuevo.

## Pantallas

1. **Resumen** — KPIs del período seleccionado (ventas brutas, comisiones ML,
   envío, publicidad, costo de productos, rentabilidad neta en $ y %) + gráfico de
   tendencia de rentabilidad neta en el tiempo. Selector de período (hoy / semana /
   mes / rango custom).
2. **Productos** — tabla: título/SKU, precio actual, costo vigente (editable
   inline), margen %, unidades vendidas en el período, rentabilidad total del
   producto. Productos sin costo cargado se destacan visualmente.
3. **Ventas** — listado de órdenes con desglose completo por línea (precio,
   comisión, envío, publicidad prorrateada, costo, ganancia neta), filtrable por
   producto/fecha/estado.
4. **Tendencias** — evolución mensual de rentabilidad, comparación entre períodos.

## Manejo de errores

- Token vencido → refresh automático transparente; si el refresh falla, la UI pide
  reautenticar.
- Rate limit de la API de ML → backoff y reintento; la UI muestra progreso del sync
  y no se cuelga si tarda.
- Producto sin costo cargado → excluido de la rentabilidad neta de cuenta, marcado
  explícitamente en la UI (nunca se asume $0 silenciosamente).
- Falla de un tool MCP puntual durante el sync (ej. Ads API no disponible) → el
  resto del sync continúa; se informa qué partes no se pudieron actualizar.

## Riesgo a validar temprano

El acceso a la API de Mercado Ads (gasto en publicidad) puede requerir un
scope/producto aprobado aparte del estándar de Items/Orders. Antes de construir el
pipeline completo de ads, se hace una prueba puntual contra la cuenta real para
confirmar acceso. Si no está disponible, el resto del dashboard funciona igual,
solo sin el dato de publicidad hasta habilitarlo.

## Testing

Cobertura enfocada, no ceremonia completa de TDD/e2e — es una herramienta personal.
Prioridad:
- Tests unitarios exhaustivos de la función de cálculo de rentabilidad
  (`net_profit`, prorrateo de ads, selección de costo vigente por fecha) — es
  dinero real, tiene que estar bien probado con casos borde (sin costo cargado,
  cambio de costo a mitad de período, sin ads_spend, etc.).
- Sin suite e2e ni cobertura mínima obligatoria para el resto del código en el v1.

## Adenda: referencia visual y métricas de marketing (post-aprobación inicial)

Tras aprobar el diseño original, el usuario compartió como referencia visual la
app Escalafy (escalafy.com) y pidió replicar su estilo y sus datos. Se resolvieron
dos decisiones que esa referencia tocaba directamente:

- **El costo sigue siendo único por producto** (no se separa en Producto / Com. MP
  / Cuotas / Variables / Impuestos como en la referencia). El desglose visual de
  "última venta" usa los componentes que ya tenemos: Facturación, Comisión ML,
  Envío, Publicidad, Costo cargado, Ganancia neta.
- **Meta Ads, Google Ads y TikTok Ads se cargan a mano**, no por API. Conectar
  esas 3 plataformas por API real requiere crear una app y pasar revisión en cada
  una (a diferencia de ML, donde ya existe la app) — no es compatible con "rápido
  y fácil". Se agrega un formulario simple para cargar gasto diario total por
  canal (`ads_spend.channel`: `mercado_ads` | `meta` | `google` | `tiktok`).
  Importante: el gasto cargado a mano es **a nivel cuenta**, no por producto (no
  hay forma de atribuir ese gasto a un SKU sin píxel/UTM), así que **no** entra en
  el prorrateo por producto (`order_items.net_profit` sigue usando solo el gasto
  de Mercado Ads, que sí viene con `product_id`). Sí entra en las métricas de
  cuenta (Ad Spend total, MER, ROAS, CPA).

### Estilo visual

Tema oscuro (fondo casi negro, acentos magenta/rosa como la referencia), grillas
de tarjetas KPI agrupadas por sección ("Tienda", "Anuncios"), tabla de últimas
órdenes, y una tarjeta "Última venta" con barras horizontales tipo waterfall.

### Métricas nuevas en el Resumen

Definiciones propias (la referencia no publica sus fórmulas exactas, así que se
documentan acá para poder ajustarlas si no coinciden con lo esperado):

| Métrica | Fórmula |
|---|---|
| Orders | Cantidad de órdenes en el período |
| Revenue | Suma de `unit_price * quantity` (ventas brutas) |
| AOV | Revenue / Orders |
| Net Profit | Suma de `net_profit` (excluye líneas sin costo cargado) |
| Profit % | Net Profit / Revenue |
| Net Rev. | Revenue − Comisión ML − Envío (margen antes de costo propio y ads) |
| Ad Spend | Publicidad ML (prorrateada) + gasto manual Meta/Google/TikTok del período |
| MER | Revenue / Ad Spend |
| ROAS | Revenue / Ad Spend (mismo cálculo que MER: sin atribución por canal no se pueden distinguir) |
| CPA | Ad Spend / Orders |
| Net AOV | Net Profit / Orders |
| True CPA | Ad Spend / Orders con costo cargado (excluye órdenes sin costo, más realista) |

### Últimas órdenes

Tabla a nivel orden (no por línea): Order Id, Estado Pago, Created At, Total
Order, Total Neto (suma de `net_profit` de sus líneas). La columna "Camino de
compra" de la referencia (atribución de marketing) queda fuera de alcance: no
tenemos fuente de datos de atribución y no se va a inventar.

## Adenda: alertas de stock Full y paridad con Escalafy (roadmap post-v1)

El usuario pidió, sobre la base de la referencia visual de Escalafy ya usada en la
adenda anterior, cubrir como mínimo las mismas features que ofrece esa app. Esto
queda anotado como roadmap — no se implementa en esta sesión, es para después de
que el deploy esté funcionando.

### Lo que Escalafy ofrece (relevado 2026-07-28)

- Centraliza ventas de Tiendanube, Shopify y Mercado Libre en un solo dashboard.
- Gasto de Meta, Google y TikTok Ads centralizado junto con el orgánico.
- Gestor de costos automático: producto, envío, comisión (por categoría/publicación,
  incluyendo Full específicamente), cuotas de Mercado Pago, impuestos/retenciones,
  agencia, descuentos.
- Ganancia real por día, margen por SKU.
- Alertas de reposición: avisa antes de quedarse sin stock, según velocidad de venta.
- Alta en menos de 15 minutos.

### Qué ya cubrimos (sin cambios)

- Ganancia por producto y por cuenta, con costo versionado por fecha.
- Publicidad: Mercado Ads automático (prorrateado por producto) + Meta/Google/TikTok
  a mano, a nivel cuenta (ver adenda anterior sobre por qué no es por API).
- Multi-cuenta con aislamiento real (RLS), login por cliente.
- Multi-canal (Tiendanube/Shopify) queda **fuera de alcance a propósito** — este
  producto es específicamente para vendedores de Mercado Libre, no un ERP
  multi-canal genérico. No se considera un gap a cerrar.

### Features nuevas a construir para alcanzar paridad

1. **Alertas de stock bajo en Full** (pedido explícito del usuario, 2026-07-28).
   - El dato de stock que ya trae `listProducts` (`available_quantity`) sirve tal
     cual para productos Full — Mercado Libre ya refleja el stock del depósito Full
     en ese mismo campo. Falta sumar `shipping.logistic_type` a la respuesta para
     distinguir qué productos son Full (vs. despacho propio) y no alertar sobre
     productos que no son Full.
   - Falta un umbral configurable por producto ("avisame si baja de X unidades"),
     guardado por cuenta — nueva columna/tabla, con su propia política RLS igual
     que el resto.
   - Canal de aviso — decisión pendiente para cuando se construya:
     - v1 barato: banner en Resumen, visible la próxima vez que el dueño entra a
       la app. No requiere infraestructura nueva.
     - v2: email real (llega sin que el dueño abra la app), requiere sumar un
       proveedor de envío de mails (ej. Resend) — pieza nueva del stack.
2. **Alertas de reposición por velocidad de venta** (no solo umbral fijo): estimar
   cuántos días de stock quedan según el ritmo de ventas reciente, no solo
   "quedan N unidades". Depende de (1).
3. **Desglose de costo más fino** (comisión por categoría/publicación, cuotas de
   Mercado Pago, impuestos/retenciones) — hoy el costo es un único número por
   producto, por decisión explícita ya tomada (ver "Decisiones abiertas descartadas
   explícitamente" más abajo). Si se persigue paridad total con Escalafy en este
   punto, implica revisar esa decisión — no se toca sin confirmarlo de nuevo con
   el usuario primero, porque ya se descartó una vez a propósito por simplicidad.

## Adenda: "Resultado del día" + costo real de multi-canal (2026-07-30)

El usuario pidió (a) reconsiderar multi-canal (Tiendanube/Shopify) — antes marcado
"fuera de alcance a propósito" — preguntando puntualmente cuánta complejidad suma,
(b) investigar si las APIs necesarias (Meta, Tiendanube, Shopify, Mercado Pago)
cobran por consulta, y (c) una página nueva "Resultado del día" con la estética
actual, inspirada en capturas de Escalafy.

### (c) Hecho en esta sesión

`app/resultado-del-dia/page.tsx` — tabs Hoy/Ayer/Este mes, ganancia neta con delta
real vs. ayer (calculado de dos llamados a `/api/summary`, nunca inventado — no hay
delta si no hay dato de ayer), facturación, margen, y la misma tarjeta de "última
venta" que Resumen. No requirió cambios de backend, reusa `/api/summary` y
`/api/orders` tal cual existían.

### (a) Complejidad real de sumar Tiendanube/Shopify

Mismo patrón que Mercado Libre, repetido por plataforma: OAuth propio, cliente API
propio (`mcp/*-client.ts`), mapeo de campos propio, sync propio, y una columna/tabla
de "canal" en el modelo de datos para no mezclar pedidos de distintas plataformas
bajo el mismo `account_id`. No es una reescritura — es "una vez más, por
plataforma" — pero tampoco es gratis: cada plataforma nueva es, en esfuerzo, similar
a lo que ya se hizo para ML (fue varias tareas del plan original).

### (b) Costo de las APIs (investigado con búsqueda web, 2026-07-30)

Ninguna cobra por consulta:

- **Meta Marketing API**: gratis, con rate-limit por app (sistema de puntos: lectura
  1pt, escritura 3pt). Acceso limitado por defecto; para más volumen hace falta
  pasar el "App Review" de Meta (≥500 llamados exitosos, <15% error) — es *tiempo*,
  no dinero. [AdManage.ai](https://admanage.ai/blog/meta-ads-api)
- **Tiendanube API**: gratis, requiere sumarse al programa de Socios Tecnológicos
  (acuerdo + revisión técnica de Tiendanube). El revenue-share que piden solo aplica
  a features de *pagos y envíos* — no aplica a un dashboard de solo lectura.
  [Tiendanube Partners](https://www.tiendanube.com/blog/tiendanube-partners/)
- **Shopify Admin API**: gratis para una app privada conectada a la tienda de cada
  cliente (no hace falta publicarla en la Shopify App Store, que es lo único que
  tendría revisión/costo asociado). Los presupuestos de "$5.000–$80.000" que
  aparecen buscando son estimaciones de agencias de desarrollo de terceros, no un
  cargo de Shopify.
- **Mercado Pago API**: gratis. Las "comisiones"/"cuotas" que se ven en dashboards
  tipo Escalafy son el costo real que le cobran al vendedor por cobrar (un dato a
  mostrar), no un cargo por consultar la API.

Conclusión: el costo de escalar a estas plataformas es 100% tiempo de desarrollo +
procesos de aprobación de cada una, no facturas de infraestructura.

### Aviso pendiente de confirmar

Varias de las features de las capturas de Escalafy (desglose de costo en Producto /
Com. MP / Cuotas / Envío / Variables / Impuestos, comisión de ML desglosada por
categoría/FULL/publicación) **necesitan volver atrás sobre una decisión ya tomada
a pedido del usuario**: "el costo es un único número por producto, no se separa en
componentes" (ver más abajo). No se tocó esa decisión en esta sesión — queda
pendiente de confirmación explícita antes de construir esa parte.

## Decisiones abiertas descartadas explícitamente

- No se versiona el costo con reglas complejas de prorrateo entre costos (ej.
  costo distinto por lote/partida) — un costo vigente por vez, versionado por
  fecha, alcanza para el caso de uso.
- No se separa el costo en componentes (COGS, empaque, impuestos) — se carga como
  un único "costo final" por producto, según preferencia explícita del usuario.
