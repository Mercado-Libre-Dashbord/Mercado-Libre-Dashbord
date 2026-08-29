# MetricsField Retail — documentación de producto

Esta carpeta es la fuente de verdad de **qué estamos construyendo y por qué**.
Está escrita para que alguien que se suma al equipo pueda entender el producto
completo en una hora y empezar a aportar sin tener que reconstruir el contexto
preguntando.

Regla que sostiene estos documentos: **lo que está acá refleja el código que
existe**. Cuando algo todavía no está construido, se dice explícitamente y se
marca cómo. Cuando algo es una decisión que todavía no tomamos, se marca
`DECISIÓN PENDIENTE` en vez de inventar una respuesta. Si al leer algo no
coincide con el código, es un bug del documento: corregilo en el mismo PR.

## Índice

| Documento | Para qué sirve | Quién lo necesita |
|---|---|---|
| [01 · Producto y dolor](01-producto.md) | Qué es MetricsField Retail, para quién, qué dolor resuelve y por qué el cliente pagaría | Todos |
| [02 · Modelo de negocio](02-modelo-de-negocio.md) | Cómo se monetiza, unit economics, costos de infraestructura, go-to-market | Todos |
| [03 · Datos](03-datos.md) | Qué datos traemos, de dónde, con qué frecuencia, y qué NO tenemos | Producto y desarrollo |
| [04 · Panel del cliente](04-panel-del-cliente.md) | Pantalla por pantalla, con la fórmula exacta de cada número | Producto, desarrollo, soporte |
| [05 · Fidelización y reviews](05-fidelizacion-y-reviews.md) | El circuito de puntos, opiniones, cupón y billetera | Todos |
| [06 · Arquitectura](06-arquitectura.md) | Stack, seguridad, sincronización, multicanal, facturación | Desarrollo |
| [07 · Estado y roadmap](07-estado-y-roadmap.md) | Qué está terminado, qué falta, qué está bloqueado y por quién | Todos |

La documentación **técnica de instalación** (variables de entorno, cómo levantar
el proyecto, cómo correr los tests) vive en el [README raíz](../../README.md).

## Resumen ejecutivo (una página)

**Qué es.** Un panel web que le dice a un vendedor de Mercado Libre cuánta plata
gana *de verdad* con cada venta y con cada producto, después de descontar
comisión, envío, publicidad, costo de mercadería, IVA y otros impuestos. Encima
de esa base, un módulo de fidelización que convierte compradores sueltos en
seguidores y reseñas dentro de Mercado Libre.

**Qué dolor resuelve.** El vendedor de Mercado Libre ve facturación, no
ganancia. Mercado Libre le muestra cuánto vendió; nadie le muestra cuánto le
quedó. Hoy lo resuelve con una planilla que actualiza a mano, tarde y mal, o
directamente no lo resuelve y descubre a fin de mes que su producto estrella
vendía a pérdida.

**Por qué somos distintos.** Tres cosas que la competencia no hace juntas:
1. **La ganancia neta es honesta**: descontamos el IVA (nadie lo hace) y el
   costo de envío real que paga el vendedor (no el que figura en la orden), y
   cuando falta un dato lo decimos en vez de inventar un número.
2. **Fidelización nativa**: premiamos acciones que ocurren *dentro* de Mercado
   Libre —seguir la tienda, dejar una opinión— con un cupón oficial emitido por
   la API de Mercado Libre. No sacamos al comprador de la plataforma, que es lo
   que hace que no sea sancionable.
3. **Multicanal desde el diseño**: la misma cuenta va a unir Mercado Libre,
   Tienda Nube y tienda propia en un solo número de rentabilidad.

**En qué estado está.** El núcleo de rentabilidad está en producción con un
cliente real (`retail.metricsfield.com`). Fidelización fase 1 está construida y
esperando la app de billetera. Facturación (ARCA) tiene el núcleo fiscal
probado pero no está conectada a AFIP. Tienda Nube tiene el adaptador escrito
pero no el OAuth. Detalle completo en [07 · Estado y roadmap](07-estado-y-roadmap.md).

**Cómo aportar.** Elegí un ítem de la tabla de [07](07-estado-y-roadmap.md),
leé el documento que corresponda a esa área, y trabajá contra los tests: hoy
hay 173 tests que corren sin base de datos (`npx vitest run`) y son el contrato
de lo que ya funciona.
