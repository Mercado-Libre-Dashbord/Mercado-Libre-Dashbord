# 01 · Producto y dolor

## El cliente

**Quién es.** Un vendedor de Mercado Libre Argentina, Responsable Inscripto,
que factura lo suficiente como para que un error de margen le duela pero no lo
suficiente como para tener un contador que le arme reportes de rentabilidad por
SKU. En la práctica: entre 20 y 500 órdenes por mes, entre 10 y 300
publicaciones activas, gestionado por su dueño o por una persona de
administración.

**Quién NO es (todavía).** El vendedor Monotributista (nuestro cálculo de IVA
asume Responsable Inscripto — ver [03 · Datos](03-datos.md#lo-que-asumimos)), y
el vendedor enterprise con ERP propio, que ya tiene esto resuelto adentro de su
sistema.

**Nuestro primer cliente real** es Tomás. El programa arranca como *family and
friends* a propósito: nos deja iterar sobre datos reales sin comprometernos a
un SLA que todavía no podemos sostener.

## El dolor

Mercado Libre le muestra al vendedor **cuánto vendió**. No le muestra **cuánto
le quedó**. Esa diferencia es enorme y está compuesta por seis descuentos que
el vendedor no ve juntos en ningún lado:

| Descuento | Dónde lo ve hoy el vendedor |
|---|---|
| Comisión de Mercado Libre | En cada orden, una por una |
| Costo de envío que paga él | En el detalle del envío, si lo busca |
| Publicidad (Mercado Ads) | En otro panel, agregado, sin atribuir a productos |
| Costo de la mercadería | En su cabeza o en una planilla |
| IVA (débito menos crédito) | En ningún lado — aparece recién en la DDJJ |
| IIBB y otros impuestos | En ningún lado |

El resultado observable, que vimos con datos reales del primer cliente:

- **El IVA no se estaba restando en ningún cálculo**, propio ni de la
  competencia. La ganancia estaba inflada en aproximadamente el 17% de la
  facturación. Un producto con 20% de margen aparente tenía en realidad 3%.
- **El costo de envío figuraba en $0** porque la orden de Mercado Libre no lo
  trae: hay que ir a buscarlo al endpoint del envío. Cualquier cálculo que lea
  la orden y nada más está mintiendo.
- **Las órdenes canceladas se contaban como ventas.** Una orden cancelada de
  $20.900 estaba aportando $6.963 de "ganancia" que nunca existió.

Estos tres no son casos borde. Son el caso normal, y son la razón por la que un
vendedor puede estar convencido de que gana plata mientras la pierde.

### El dolor secundario: el vendedor no sabe qué hacer con el dato

Aun cuando el vendedor calcula bien su margen, sigue teniendo el mismo problema:
todas sus ventas son **transacciones de una sola vez**. Mercado Libre es dueño
de la relación con el comprador. El vendedor no tiene el mail, no tiene forma de
volver a contactarlo, y cada venta nueva le cuesta lo mismo que la primera
(comisión + publicidad).

Ahí entra el módulo de fidelización: transformar compradores anónimos en
seguidores de la tienda y en reseñas, que son los dos activos que **sí** quedan
del lado del vendedor dentro de Mercado Libre y que bajan el costo de la
siguiente venta. Ver [05 · Fidelización y reviews](05-fidelizacion-y-reviews.md).

## Qué hace el producto

En una frase: **convierte la actividad de una cuenta de Mercado Libre en una
respuesta a "¿cuánta plata gané y con qué producto?", y después usa esa misma
conexión para que el vendedor construya audiencia propia dentro de la
plataforma.**

Concretamente, hoy:

1. **Se conecta a Mercado Libre por OAuth** una sola vez y sincroniza sola
   publicaciones, órdenes, envíos, publicidad, preguntas y facturación de ML.
2. **El vendedor carga el costo de cada producto** una vez (con historial: un
   costo cargado hoy no rompe el margen de las ventas de marzo).
3. **Calcula la ganancia neta línea por línea** descontando los seis conceptos
   de la tabla de arriba, y la agrega por período, por producto y por día.
4. **Muestra el resultado** en un panel de ocho indicadores, tres gráficos y
   cuatro pantallas de detalle.
5. **Deja al vendedor operar desde ahí**: cambiar el precio en Mercado Libre,
   responder consultas de compradores, pausar campañas.
6. **Corre un programa de fidelización** con misiones dentro de Mercado Libre y
   un cupón oficial como premio.

## El valor que aportamos

Ordenado por cuánto importa, no por cuánto código tiene:

**1. Decisiones de precio y de catálogo que antes eran a ciegas.**
El vendedor descubre qué productos vende mucho y le dejan poco, y cuáles vende
poco y le dejan mucho. Esas dos listas casi nunca son la misma, y el panel las
pone una al lado de la otra a propósito.

**2. Un número de ganancia en el que se puede confiar.**
Vale más un número correcto que muchos números aproximados. Por eso: si a un
producto le falta el costo cargado, sus ventas quedan **fuera** de la ganancia
neta y el panel avisa cuántas líneas quedaron afuera. No estimamos, no
rellenamos, no promediamos. Un número inventado que parece razonable es peor
que un hueco visible, porque el hueco se arregla y el número inventado se cree.

**3. Tiempo que hoy se va en planillas.**
La alternativa real del cliente no es un competidor: es una planilla que
actualiza a mano los domingos. Le devolvemos esas horas y le sacamos los errores
de copiado.

**4. Detección temprana de productos que se apagan.**
La pantalla de Tendencias compara velocidad de venta (unidades por semana), no
totales acumulados, así que marca un producto que se está muriendo antes de que
el total mensual lo delate.

**5. Audiencia propia dentro de Mercado Libre.**
Seguidores y reseñas. Un seguidor recibe las notificaciones nativas de Mercado
Libre cuando el vendedor publica algo; una reseña mejora la conversión de la
publicación para siempre. Los dos bajan el costo de adquisición de la próxima
venta sin pagarle más a nadie.

## Por qué el cliente nos elegiría

**Contra la planilla:** no hay carga manual, el dato llega solo, y los tres
errores que la planilla siempre tiene (IVA, envío real, órdenes canceladas)
están resueltos.

**Contra los calculadores de comisiones gratuitos:** esos calculan una venta
hipotética. Nosotros calculamos las ventas que realmente ocurrieron, con el
costo real, e informamos el resultado agregado.

**Contra las herramientas de gestión más grandes:** son ERPs. Requieren migrar
el negocio entero, cuestan órdenes de magnitud más, y su reporte de rentabilidad
es una pestaña más. Nosotros hacemos una sola cosa y la hacemos bien, y se
conecta en cinco minutos.

**La diferenciación defendible a mediano plazo es la fidelización.** El cálculo
de rentabilidad es replicable por cualquiera con acceso a la misma API. El
circuito de puntos → reseñas → seguidores → cupón oficial, hecho de una forma
que no viola las políticas de Mercado Libre, es donde se construye el foso.
Detalle en [05](05-fidelizacion-y-reviews.md).

## Principios de producto

Estos no son adorno: están cableados en el código y en los tests, y valen como
criterio de decisión cuando algo es ambiguo.

1. **Nunca inventamos un número.** Falta de dato se muestra como falta de dato
   ("Sin dato", "N líneas sin costo cargado"), nunca como cero ni como estimación.
2. **Cada número explica cómo se calcula.** Todas las tarjetas del panel tienen
   un ícono ⓘ con la fórmula en castellano. El cliente tiene que poder auditarnos.
3. **Nada se manda a Mercado Libre sin que el vendedor lo confirme.** Las
   respuestas a consultas se sugieren, no se envían solas.
4. **Todo adentro de Mercado Libre.** Ninguna función puede empujar al comprador
   fuera de la plataforma: es la causa más común de suspensión de cuentas, y
   una suspensión le cuesta al cliente mucho más de lo que le cobramos nosotros.
5. **Si falta una migración, la app degrada, no explota.** Ver
   [06 · Arquitectura](06-arquitectura.md#degradación-por-capacidades-de-esquema).
