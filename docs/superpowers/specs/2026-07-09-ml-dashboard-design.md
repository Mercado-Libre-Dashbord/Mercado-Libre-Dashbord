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

## Decisiones abiertas descartadas explícitamente

- No se versiona el costo con reglas complejas de prorrateo entre costos (ej.
  costo distinto por lote/partida) — un costo vigente por vez, versionado por
  fecha, alcanza para el caso de uso.
- No se separa el costo en componentes (COGS, empaque, impuestos) — se carga como
  un único "costo final" por producto, según preferencia explícita del usuario.
