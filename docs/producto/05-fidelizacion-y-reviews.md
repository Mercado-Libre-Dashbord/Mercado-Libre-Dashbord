# 05 · Fidelización y reviews

Este es el módulo que nos diferencia. El cálculo de rentabilidad lo puede copiar
cualquiera que tenga acceso a la misma API; esto no, porque la parte difícil no
es técnica sino de diseño: hacerlo **sin que a nuestro cliente le suspendan la
cuenta**.

## El problema que resuelve

Un vendedor de Mercado Libre no es dueño de sus compradores. Mercado Libre no le
da el mail ni el teléfono, y la política de la plataforma prohíbe desviar
tráfico afuera. Así que cada venta arranca de cero: comisión completa,
publicidad completa, cero ventaja por haberle vendido antes a esa persona.

Hay exactamente **dos activos que sí quedan del lado del vendedor y viven dentro
de Mercado Libre**:

1. **Seguidores de la tienda.** Un seguidor recibe las notificaciones nativas de
   ML cuando el vendedor publica algo nuevo o hace una promoción. Es el canal de
   comunicación más parecido a una lista de mails que existe dentro de la
   plataforma, y es gratis.
2. **Opiniones (reviews).** Una publicación con opiniones convierte mejor,
   siempre y para siempre. Es el único activo del vendedor que se acumula y no
   se consume.

**El módulo de fidelización existe para fabricar esos dos activos de forma
sistemática**, en vez de esperar a que ocurran solos.

## La regla que ordena todo el diseño

> **Nada saca al comprador de Mercado Libre.**

Todas las misiones son acciones que ocurren dentro de la plataforma. El premio
es un **cupón oficial de Mercado Libre** emitido por su propia API. En ningún
punto del circuito le pedimos al comprador que vaya a un sitio externo, deje su
mail o siga una cuenta de Instagram.

No es una preferencia estética: **desviar tráfico fuera de la plataforma es la
causa más común de suspensión de cuentas de vendedor**. Una suspensión le
costaría al cliente mucho más de lo que nos paga. Un programa de fidelización
que pone en riesgo la cuenta es un producto negativo.

Esta regla está **testeada**: `lib/loyalty.test.ts` tiene un test que falla si
el texto de cualquier misión llega a mencionar instagram, tiktok, facebook,
whatsapp, una web o un `http`. Si alguien agrega una misión que rompe el
principio, el CI lo frena.

## Las misiones

Definidas en `lib/loyalty.ts`. El catálogo es **fijo a propósito**: cada misión
existe porque hay una acción real y observable del lado de Mercado Libre. Una
misión que no se puede verificar es una invitación a reclamar puntos que no se
ganaron.

| Misión | Qué ve el comprador | Puntos por defecto | Por qué está |
|---|---|---|---|
| `seguir_tienda` | *"Seguí nuestra tienda oficial en Mercado Libre"* | **1000** | La de mayor retorno: deja al comprador alcanzado por las notificaciones nativas, las historias y el canal de difusión de ML |
| `dejar_opinion` | *"Contá qué te pareció el producto en Mis Compras"* | **500** | Genera el activo que mejora la conversión de la publicación |
| `opinion_con_foto` | *"Sumá una foto a tu opinión"* | **300** | Una opinión con foto pesa mucho más que una de texto |

### La regla de las opiniones que no se negocia

**Se premia el acto de opinar, nunca la calificación.**

Condicionar una recompensa a una opinión positiva es manipulación de reseñas:
está prohibido por Mercado Libre, es desleal con los otros compradores, y a
mediano plazo destruye el valor de las opiniones para todos. El texto que ve el
comprador dice *"contá qué te pareció"*, no *"dejanos 5 estrellas"*.

También está testeado: hay un test que falla si el texto de `dejar_opinion`
llega a contener "positiv", "5 estrellas", "buena" o "cinco".

## El premio

Cuando el comprador junta los puntos suficientes, se emite un **cupón oficial de
Mercado Libre** vía `POST /seller-promotions/promotions` (tipo
`SELLER_COUPON_CAMPAIGN`).

Configuración por cuenta (pantalla **Fidelización**), con estos valores por defecto:

| Parámetro | Default | Por qué |
|---|---|---|
| Puntos necesarios | **1500** | Alcanzable completando dos misiones. Un umbral inalcanzable desmotiva más que no tener programa. |
| Monto del cupón | **$2.000** | |
| Compra mínima para usarlo | **$10.000** | El cupón tiene que traer una venta, no regalar plata |
| Presupuesto tope | **$100.000** | **Obligatorio.** Es el freno: sin tope, un error de configuración vacía la caja del vendedor |
| Programa activo | **apagado** | Nadie activa un programa de descuentos por accidente |

## El circuito completo

```
1. El vendedor configura el programa en /loyalty y lo activa.

2. El comprador recibe su pedido con un QR en el packaging.
   (El QR y la tarjeta digital viven en la app de billetera — fuera de este repo.)

3. Escanea → se da de alta como miembro y ve sus misiones.

4. Cumple una misión dentro de Mercado Libre (sigue la tienda, deja una opinión).

5. La app de billetera avisa:  POST /api/loyalty/members
                               { memberId, mission, email?, name? }

6. Este proyecto registra la misión, recalcula los puntos y responde
   cuántos le faltan para el premio.

7. Al alcanzar el umbral, emite el cupón oficial de ML y devuelve el código.

8. El comprador usa el cupón → vuelve a comprar → la venta entra por el
   sync normal y aparece en el panel de rentabilidad como cualquier otra.
```

El paso 8 es el que cierra el círculo y es la razón por la que fidelización vive
dentro de este producto y no como una herramienta suelta: **el vendedor ve en el
mismo panel cuánto le costó el programa y cuánta facturación le trajo.**

## La conexión con el resto del producto

Esto es lo que hace que el conjunto sea más que la suma de las partes:

| Fidelización genera… | …que el panel mide en… |
|---|---|
| Opiniones nuevas | **Visitas y conversión** (una publicación con opiniones convierte más) |
| Seguidores | **Ventas recurrentes** — visibles en Tendencias como productos que aceleran |
| Cupones usados | **Ticket promedio** y **Ganancia neta** (el descuento del cupón se refleja en el precio de la orden) |
| Segunda compra de un comprador | **Facturación**, sin haber pagado publicidad nueva por ella |

Y al revés: el panel es lo que le dice al vendedor **si el programa vale la
pena**. Sin la medición de rentabilidad, un programa de descuentos es fe. Con
ella, es una decisión.

## La app de billetera (fuera de este repo)

La captación del comprador —el QR, la tarjeta en la billetera del teléfono, la
pantalla de misiones— **se desarrolla en otro proyecto**. La integración entre
los dos mundos es una sola costura, y está construida y testeada de este lado:

### Contrato de `POST /api/loyalty/members`

**Entrada**
```json
{ "memberId": "id-del-comprador", "mission": "seguir_tienda", "email": "opcional", "name": "opcional" }
```

**Salida**
```json
{
  "memberId": "...",
  "completed": ["seguir_tienda"],
  "points": 1000,
  "pointsToReward": 500,
  "rewardUnlocked": false,
  "couponCode": null
}
```

**Comportamiento garantizado** (6 tests en `app/api/loyalty/members/route.test.ts`):

- **Idempotente**: repetir la misma misión no suma puntos dos veces.
- **Un cupón por miembro**: el chequeo de "ya se le otorgó" ocurre **antes** de
  llamar a Mercado Libre, así que un reintento por timeout no crea una campaña
  duplicada.
- Si el programa está desactivado, responde `409` y no hace nada.
- Si falta la migración `009-loyalty.sql`, responde `503` con el nombre del
  archivo a correr, en vez de un error 500 sin información.
- Misión desconocida → `400`.

`DECISIÓN PENDIENTE — autenticación de esta ruta.` Hoy usa la resolución de
cuenta estándar de la app. Cuando la billetera sea un servicio separado va a
necesitar su propia credencial por cuenta (una API key, seguramente). Es
requisito antes de exponerla fuera de nuestra infraestructura.

## El agujero conocido

**No podemos verificar que el comprador realmente siguió la tienda o dejó la
opinión.** Mercado Libre no expone un endpoint para consultarlo. Hoy es
**sistema de honor**: la app de billetera dice que la misión se cumplió y este
proyecto le cree.

No está escondido, está escrito acá y hay que decírselo al cliente. Tres
mitigaciones posibles, en orden de costo:

1. **El tope de presupuesto** (ya implementado): aunque alguien abuse, el daño
   está acotado a un número que el vendedor eligió.
2. **Que la billetera pida evidencia** — captura de pantalla de la opinión— y la
   valide un humano o un modelo. Es donde probablemente termine.
3. **Cotejar contra las opiniones públicas de la publicación**, si conseguimos
   una forma confiable de leerlas.

## Lo que falta en este módulo

- **Pantalla de miembros y estadísticas.** Hoy el vendedor configura el programa
  pero no puede ver cuántos miembros tiene, cuántas misiones se cumplieron ni
  cuántos cupones se emitieron. Es lo primero que va a pedir.
- **Medición del retorno del programa**: cuánta facturación vino de compradores
  con cupón. El dato está (las órdenes están sincronizadas), falta cruzarlo.
- La autenticación de la costura con la billetera (arriba).
