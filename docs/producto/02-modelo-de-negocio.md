# 02 · Modelo de negocio

> Buena parte de este documento son **decisiones que todavía no tomamos**. Están
> marcadas como `DECISIÓN PENDIENTE` con las opciones y el criterio para
> elegir. No completes un hueco de estos por tu cuenta en el código: traelo a la
> conversación primero, porque casi todos tienen consecuencias de producto.

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

`DECISIÓN PENDIENTE — precio y estructura.`

El eje del que hay que elegir no es el precio, es **la variable que lo escala**.
Las tres opciones reales, con su consecuencia:

| Estructura | A favor | En contra |
|---|---|---|
| **Precio fijo por cuenta** (ej. un plan único mensual) | Simplísimo de explicar y de facturar. El cliente sabe exactamente qué paga. | Un vendedor chico y uno grande pagan lo mismo; dejamos plata arriba de la mesa con los grandes y espantamos a los chicos. |
| **Por volumen de facturación sincronizada** (escalones) | Se alinea con el valor: el que más factura es al que más le rinde saber su margen. Crece con el cliente. | Le mostramos al cliente que sabemos cuánto factura y le cobramos por eso; genera resistencia. Requiere escalones bien elegidos o el salto duele. |
| **Por cantidad de publicaciones activas** | Correlaciona con el trabajo real que hace el sistema (sincronización, costos a cargar) y no se siente invasivo. | Correlaciona peor con el valor percibido: 500 publicaciones que no venden no valen más que 20 que sí. |

**Recomendación para discutir:** escalones por facturación mensual
sincronizada, con un plan de entrada barato que cubra al vendedor chico. Es lo
que mejor alinea precio con valor, y el dato ya lo tenemos calculado — no hay
que medir nada nuevo.

`DECISIÓN PENDIENTE — el módulo de fidelización, ¿va incluido o es un add-on?`
Argumento para incluirlo: es la diferenciación, y si se paga aparte casi nadie
lo prueba. Argumento para cobrarlo aparte: tiene un costo variable real (los
cupones los paga el vendedor, pero la emisión y el soporte los damos nosotros) y
es el módulo con más valor percibido.

`DECISIÓN PENDIENTE — facturación electrónica (ARCA), ¿es parte del plan o un
plan superior?` Ver [07 · Roadmap](07-estado-y-roadmap.md#facturación-arca);
tiene un costo de responsabilidad legal que conviene reflejar en el precio.

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

`DECISIÓN PENDIENTE — cuándo migramos a Vercel Pro y Supabase Pro.` La respuesta
por defecto es "el día antes de emitir la primera factura".

## Go-to-market

**El canal natural es el boca a boca entre vendedores.** Los vendedores de
Mercado Libre están agrupados (grupos de WhatsApp, comunidades, cursos de
e-commerce) y se recomiendan herramientas entre ellos constantemente. Un cliente
contento que muestra su panel es la mejor publicidad que vamos a tener.

**El gancho de venta es una demostración, no una explicación.** La frase que
vende es: *"conectá tu cuenta y en cinco minutos te digo cuánto ganás de verdad
con tu producto más vendido — te apuesto a que es menos de lo que pensás"*.
Funciona porque es cierta y porque es verificable en el momento.

`DECISIÓN PENDIENTE — ¿hay prueba gratis, y de cuánto?` La opción fuerte es un
período de prueba que incluya la sincronización histórica completa: el valor se
ve recién cuando el vendedor tiene tres meses de datos cargados.

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
