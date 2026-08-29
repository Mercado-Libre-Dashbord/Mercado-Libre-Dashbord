# 02 · Modelo de negocio

> **Las decisiones de precio ya están tomadas y viven en el
> [masterplan](00-masterplan.md#4-cómo-cobramos)**, con la investigación de
> competencia que las sustenta. Este documento explica la forma del negocio y
> los costos.
>
> Lo único que queda abierto es **el número en pesos** de los planes, y el
> criterio para fijarlo está más abajo. No lo completes por tu cuenta en el
> código: traelo a la conversación primero.

## Forma del negocio

**SaaS B2B multi-cuenta, suscripción mensual.** Un solo despliegue atiende a
todos los clientes; cada cliente es una fila en `accounts` y ve exclusivamente
sus datos (aislamiento garantizado por Postgres, no por el código de la app —
ver [06 · Arquitectura](06-arquitectura.md#seguridad-rls)).

El cliente entra con su cuenta de Google, conecta su cuenta de Mercado Libre por
OAuth, carga los costos de sus productos y ya tiene el panel funcionando. No hay
implementación, no hay migración de datos, no hay onboarding asistido
obligatorio.

## Etapa actual: family and friends

Estamos en la etapa deliberadamente previa a cobrar:

- **Un cliente real en producción** (Tomás), usando el producto con datos reales.
- Sin precio, sin contrato, sin SLA.
- El objetivo de esta etapa **no es facturar**: es descubrir qué números del
  panel el cliente mira todos los días y cuáles no mira nunca, y encontrar los
  casos borde de los datos de Mercado Libre con una cuenta real. Ya nos dio tres
  hallazgos que ninguna cantidad de diseño hubiera encontrado (IVA no restado,
  envío en cero, canceladas contadas como ventas).

**Criterio para salir de esta etapa:** cuando el cliente pueda pasar un mes sin
que aparezca un número mal calculado, y cuando use el panel para tomar al menos
una decisión concreta de precio o de catálogo. Ahí el producto vale plata; antes
no.

## Cómo vamos a cobrar

**Decidido: escalones por cantidad de órdenes mensuales, con 30 días de prueba
gratis sin tarjeta.** El razonamiento completo, la investigación de competencia
que lo respalda y la estructura de planes están en el
[masterplan · Cómo cobramos](00-masterplan.md#4-cómo-cobramos).

El resumen de por qué:

- **Volumen y no fijo**, porque un precio fijo espanta al vendedor chico y deja
  plata sobre la mesa con el grande. Los dos referentes que importan cobran así:
  Real Trends (el líder argentino) por ventas de los últimos 30 días, y
  sellerboard (el equivalente en Amazon) por órdenes mensuales.
- **Por órdenes y no por facturación**, porque con inflación la facturación sube
  sola y escalonar por ahí empuja al cliente a un plan más caro sin que haya
  crecido. La cantidad de órdenes es la única medida de volumen que la inflación
  no distorsiona.
- **Prueba gratis de 30 días sin tarjeta**, porque es el estándar de la
  categoría (Real Trends 30 días, ProfitOS 14, Nubimetrics 14) y porque nuestro
  valor es invisible hasta que la cuenta está conectada y los costos cargados:
  la prueba no es marketing, es la demo.
- **Todas las funciones en todos los planes.** Lo único que cambia es el
  volumen.

Lo que queda por definir es el número en pesos del escalón de entrada, con este
criterio: **tiene que costar menos que el margen que el vendedor recupera
corrigiendo el precio de un solo producto.**

## Costos: qué nos cuesta atender un cliente

**Costo marginal por cliente: casi cero.** No hay costo por transacción, no
pagamos por llamada a la API de Mercado Libre, y el trabajo de sincronización de
un cliente más es despreciable frente al plan base. Esto es bueno: el margen
bruto de un SaaS así es altísimo. También es una trampa, porque **el costo real
por cliente es el soporte**, y ese sí escala con la cantidad de clientes.

Infraestructura actual:

| Componente | Plan hoy | Nota |
|---|---|---|
| Vercel (hosting Next.js) | Hobby | ⚠️ ver abajo |
| Supabase (Postgres) | Free | El plan free pausa proyectos inactivos y tiene límite de tamaño |
| Mercado Libre API | Gratis | Sin costo por llamada, con rate limits |
| Dominio `metricsfield.com` | — | Costo anual fijo |

> ⚠️ **Riesgo a resolver antes de cobrarle a alguien:** el plan **Hobby de
> Vercel es para uso no comercial**. En el momento en que le cobremos a un
> cliente, el despliegue tiene que estar en un plan Pro. No es un detalle
> administrativo: es una condición para que el producto no se caiga de un día
> para el otro. Además el plan Hobby limita las funciones serverless a 60
> segundos, que es la razón por la que la sincronización está partida en lotes
> de 50 órdenes (ver [06 · Arquitectura](06-arquitectura.md#sincronización)).

**Decidido:** migramos a Vercel Pro y Supabase Pro **antes de emitir la primera
factura**. No hay objeción de costo; es un requisito de lanzamiento, no un
debate.

## Go-to-market

**El canal natural es el boca a boca entre vendedores.** Los vendedores de
Mercado Libre están agrupados (grupos de WhatsApp, comunidades, cursos de
e-commerce) y se recomiendan herramientas entre ellos constantemente. Un cliente
contento que muestra su panel es la mejor publicidad que vamos a tener.

**El gancho de venta es una demostración, no una explicación.** La frase que
vende es: *"conectá tu cuenta y en cinco minutos te digo cuánto ganás de verdad
con tu producto más vendido — te apuesto a que es menos de lo que pensás"*.
Funciona porque es cierta y porque es verificable en el momento.

**Decidido: prueba gratis de 30 días, sin tarjeta, que arranca al conectar
Mercado Libre** (no al registrarse) e incluye la sincronización histórica
completa. El valor se ve recién cuando el vendedor tiene meses de datos
cargados. Detalle en el [masterplan](00-masterplan.md#decisión-sí-a-la-prueba-gratis-30-días-sin-tarjeta).

Dos canales adicionales a evaluar, ambos analizados en el masterplan: el
**Centro de Partners de Mercado Libre** (donde están Real Trends y Nubimetrics)
y publicar una **calculadora gratuita** que capture la búsqueda que hoy se
llevan media docena de sitios.

## Riesgos del modelo

1. **Dependencia total de la API de Mercado Libre.** Si cambian un endpoint o
   nos restringen el acceso, el producto deja de funcionar. Mitigación parcial:
   la arquitectura multicanal (ver [06](06-arquitectura.md#multicanal)) reduce
   la dependencia a mediano plazo, y Tienda Nube es el primer paso.
2. **Mercado Libre podría construir esto.** Tienen todos los datos menos uno: el
   costo de la mercadería. Ese dato solo lo tiene el vendedor, y es exactamente
   el que hace falta para calcular rentabilidad. Es una defensa real pero no
   eterna.
3. **Custodia de datos sensibles.** Guardamos tokens de Mercado Libre y —si
   avanza ARCA— eventualmente certificados fiscales. Una filtración no es un
   incidente técnico, es el fin del negocio. Ver
   [06 · Seguridad](06-arquitectura.md#seguridad-rls).
4. **El soporte no escala solo.** Cada cliente nuevo trae preguntas sobre sus
   propios números. La respuesta estructural es que el producto explique sus
   cálculos dentro de la interfaz —por eso existen los ⓘ en cada tarjeta— y no
   por chat.
