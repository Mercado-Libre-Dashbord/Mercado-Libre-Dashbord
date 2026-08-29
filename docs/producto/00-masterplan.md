# 00 · Masterplan MetricsField Retail

> Documento maestro. Agrupa la estrategia: dónde estamos parados en el mercado,
> contra quién competimos de verdad, cómo cobramos, dónde ganamos y qué hay que
> construir en qué orden.
> Los documentos 01 a 07 son el detalle; este es la decisión.
>
> **Última actualización:** 29 de agosto de 2026. Investigación de competencia
> realizada en esa fecha — las fuentes están al final.

---

## 1. La tesis en cuatro frases

1. Un vendedor de Mercado Libre no sabe cuánta plata gana. Sabe cuánto factura.
2. Nosotros se lo decimos bien: con IVA argentino real, envío real y órdenes
   canceladas afuera.
3. Pero eso **ya no alcanza para diferenciarnos** — hay competencia haciéndolo.
4. Lo que sí nos diferencia es lo que viene después: convertir a esos
   compradores en seguidores y opiniones dentro de Mercado Libre, y medir en el
   mismo panel cuánta plata trajo eso.

**El panel de rentabilidad es el caballo de Troya. La fidelización es el
negocio.**

---

## 2. Contra quién competimos de verdad

Esto corrige lo que creíamos hace un mes. **No estamos en un mercado vacío.**

### El líder local: Real Trends 🇦🇷

Argentina. Partner Platinum de Mercado Libre. **Más de 10.000 vendedores** y
1.200 tiendas oficiales (Frávega, Adidas, Walmart, Simmons). Rentable desde los
8 meses de vida.

Qué hace: gestión operativa (preguntas y mensajes con IA, ventas, envíos),
analítica, monitoreo de competencia, multi-cuenta, apps iOS/Android, y una
tienda online propia gratis (0,75% por venta). **Y sí muestra "cuánta plata te
queda de cada venta"**, calculando el envío automáticamente por código postal.

Cómo cobra: **escalones según la cantidad de ventas de los últimos 30 días**,
con ajuste automático mes a mes, cobro por Mercado Pago, precios sin IVA.
**30 días de prueba gratis sin tarjeta.**

> Los precios que circulan en la web (5 escalones, proporción 1×–5×) están
> desactualizados por inflación. Lo que importa y sí es vigente es **la
> estructura**: escalones por volumen de ventas, ajuste automático, prueba de 30
> días.

### El competidor directo de nuestra propuesta: ProfitOS 🇲🇽

México. Hace **exactamente lo que hacemos nosotros**: ganancia real por venta
con comisión, IVA, envío y costo de mercadería desglosados en tiempo real.
Además: inventario FIFO, reportes fiscales, publicidad integrada, multi-usuario.

Cómo cobra: **todas las funciones en todos los planes; lo que cambia es el
volumen de órdenes y la cantidad de usuarios** (+$199 MXN por usuario extra).
**14 días de prueba sin tarjeta.**

Es la validación más fuerte de que el problema existe y de que se puede cobrar
por resolverlo. También es la prueba de que nuestro cálculo de rentabilidad, por
sí solo, no es un foso.

### Los demás

| Quién | Qué es | Amenaza |
|---|---|---|
| **Nubimetrics** | Inteligencia de mercado (qué vender, competencia). Fundada en 2013, sin precios públicos, venta consultiva, 14 días de prueba | **Baja** — categoría distinta: investigación de mercado, no rentabilidad propia |
| **Snow Profit** | Rentabilidad y P&L para ML y Amazon, México y Argentina | **Media** — se acerca, hay que seguirlo |
| **Calculadoras gratis** (Unidrop, DigitalSellers, Calcusite, SmartSelling, SpomSolutions, Snowprofit…) | Simuladores de una venta hipotética. **Sí calculan IVA y percepciones** | **Baja como producto, alta como ancla de precio**: acostumbran al vendedor a que "esto es gratis" |
| **Astroselling, UpSeller, ERPs** | Conectores multicanal y gestión. ERPs de US$500–1.500/mes | **Baja** — otra categoría y otro presupuesto |
| **El panel nativo de Mercado Libre** | Métricas de negocio, gratis | **Estructural, no inmediata**: tienen todo menos el costo de la mercadería, que solo lo tiene el vendedor |

### Corrección honesta a lo que decíamos antes

Habíamos escrito que "nadie descuenta el IVA". **Es falso y hay que dejar de
decirlo.** Las calculadoras gratuitas argentinas calculan IVA y percepciones, y
ProfitOS lo hace sobre ventas reales.

Lo que sí sostiene la evidencia, y es más chico pero es cierto:

- Las calculadoras gratis calculan **una venta hipotética**, no las ventas que
  ocurrieron. Nunca te dicen cuánto ganaste el mes pasado.
- Nadie que hayamos encontrado **excluye del resultado las líneas sin costo
  cargado**. Todos muestran un número igual. Nuestra regla de "hueco visible en
  vez de número inventado" es genuinamente distinta.
- El competidor que hace lo mismo que nosotros **es mexicano** y su fiscalidad
  es otra (IVA 16% + ISR).

---

## 3. Dónde ganamos

Ordenado por cuán defendible es, no por cuán lindo suena.

### 🟢 Defendible: fidelización dentro de Mercado Libre

**No encontramos ninguna herramienta de terceros que corra un programa de
fidelización a nivel vendedor dentro de Mercado Libre.** Es aire libre.

Y el terreno está preparado por la propia plataforma:
- Mercado Libre **ya premia las opiniones**, especialmente las que llevan foto.
  El comprador ya está educado en la mecánica.
- El **canal de difusión** existe: un vendedor puede mandarles cupones
  exclusivos a sus seguidores. O sea que "conseguir seguidores" tiene un uso
  concreto y nativo, no es una métrica de vanidad.
- El cupón se emite por la **API oficial** de promociones del vendedor.

Nadie ocupa ese espacio, la plataforma lo habilita, y nosotros ya lo tenemos
construido (fase 1). **Este es el foso.**

### 🟢 Defendible: fiscalidad argentina de verdad

El competidor funcional directo es mexicano. Nosotros somos el único que combina:
IVA de Responsable Inscripto calculado como débito menos crédito sobre ventas
reales, alícuota de IIBB configurable, y facturación electrónica ARCA en el
roadmap.

La facturación ARCA es un **cambio de categoría**: pasamos de "herramienta que
mira" a "herramienta que hace". Un vendedor no cambia de software que le emite
las facturas. Eso es retención pura.

### 🟡 Diferencial real pero copiable: la honestidad del número

Excluir las líneas sin costo, mostrar "Sin dato" en vez de cero, explicar cada
fórmula con un ⓘ. Genera confianza y es lo que hace que un cliente nos crea.
Cualquiera puede copiarlo en un sprint — pero primero tiene que querer, y la
mayoría prefiere mostrar un número lindo.

### 🟡 Diferencial en construcción: multicanal

Mercado Libre + Tienda Nube + tienda propia en un solo número de rentabilidad.
Real Trends tiene tienda propia; ProfitOS es solo ML. Cuando esté terminado nos
pone en un lugar donde hoy no hay nadie exacto.

### 🔴 Donde perdemos hoy — sin vueltas

| Ellos tienen | Nosotros |
|---|---|
| Real Trends: 10.000+ vendedores, partner Platinum, apps móviles, monitoreo de competencia, IA para preguntas, multi-cuenta, tienda incluida | 1 cliente, sin app móvil, sin multi-usuario |
| ProfitOS: inventario FIFO, reportes fiscales, multi-usuario | Nada de eso |
| Ambos: marca, casos, comunidad | Cero reputación pública |

**No compitamos de frente contra Real Trends.** Ellos son una suite operativa;
nosotros somos rentabilidad + fidelización. Un vendedor puede tener las dos
cosas, y de hecho es el escenario más probable en el corto plazo.

---

## 4. Cómo cobramos

### Decisión: por cantidad de órdenes, en escalones

**Volumen, no fijo.** Y específicamente **por cantidad de órdenes, no por
facturación.**

Por qué volumen y no fijo:
- Un precio fijo espanta al vendedor chico y deja plata sobre la mesa con el
  grande. No hay un número que sirva para los dos.
- **Los dos referentes que importan cobran así.** Real Trends por ventas de los
  últimos 30 días; sellerboard —el equivalente de nuestro producto en Amazon,
  internacional— por órdenes mensuales (US$19 / 29 / 39 / 79). Cuando el líder
  local y el referente global convergen en la misma estructura sin conocerse,
  esa estructura es la correcta.
- Nuestro costo real de servir también escala con las órdenes: cada orden es
  sincronización, almacenamiento y cálculo.

Por qué **órdenes** y no **facturación** — y esto es lo importante en Argentina:

> Con inflación, la facturación de un vendedor sube todos los meses **sin que
> haya crecido nada**. Si escalonáramos por facturación, la inflación sola lo
> empujaría a un plan más caro y sentiría —con razón— que le cobramos más por
> vender lo mismo. **La cantidad de órdenes es la única medida de volumen que la
> inflación no distorsiona.**

Además la cantidad de órdenes es menos invasiva: cobrarle a alguien por un
número que le calculamos sobre su facturación genera una resistencia que el
conteo de órdenes no genera.

### La estructura propuesta

| Plan | Órdenes por mes | Precio relativo | Para quién |
|---|---|---|---|
| **Base** | hasta 50 | 1× | El vendedor que arranca o el que vende pocas cosas caras |
| **Crece** | 51 – 250 | 2× | El grueso del mercado |
| **Escala** | 251 – 1.000 | 3× | Vendedor consolidado, probablemente con empleados |
| **Pro** | más de 1.000 | 4× | Tienda oficial chica |

- **Todas las funciones en todos los planes.** Lo único que cambia es el volumen
  (y más adelante, la cantidad de usuarios). Es lo que hace ProfitOS y evita la
  peor conversación de ventas: "pagame más para ver un número que ya calculé".
- **El escalón se recalcula solo cada mes**, como Real Trends. Nada de llamar
  para cambiar de plan.
- **Cobro por Mercado Pago.** En Argentina es la vía de menor fricción, y
  nuestro cliente ya la usa todos los días.
- **Precios sin IVA**, explicitado. Nuestro cliente es Responsable Inscripto y
  lo toma como crédito fiscal.
- **Descuento anual del 20%** (es el estándar: sellerboard usa exactamente eso).

`DECISIÓN PENDIENTE — el número del escalón Base en pesos.` No lo fijo acá a
propósito: cualquier cifra en pesos que escriba hoy está vieja en tres meses.
El criterio para elegirla, que sí vale siempre:

> **El plan Base tiene que costar menos que el margen que el vendedor recupera
> corrigiendo el precio de UN solo producto.** Si el panel le muestra que su
> producto estrella deja 3% en vez de 20% y lo reajusta, eso solo paga el año.
> Esa frase es, además, el argumento de venta.

`DECISIÓN PENDIENTE — indexación.` Con inflación, el precio en pesos hay que
revisarlo trimestralmente. Las opciones son atarlo a una referencia (dólar,
UVA, IPC) o revisarlo a mano avisando con anticipación. **Recomiendo revisión
manual trimestral con aviso**: atar a dólar es transparente pero psicológicamente
caro, y el cliente lo lee como que le cobramos en dólares.

`DECISIÓN PENDIENTE — fidelización, ¿incluida o add-on?` **Recomiendo incluida
en todos los planes.** Es la diferenciación: si se paga aparte, casi nadie la
prueba, y un módulo diferenciador que nadie prueba no diferencia nada. Cuando
tengamos evidencia de que trae ventas, puede volverse la razón de un plan
superior — no antes.

`DECISIÓN PENDIENTE — facturación ARCA, ¿plan superior?` **Recomiendo que sí**,
cuando exista. Tiene costo de responsabilidad legal y de soporte, y es la
función por la que un vendedor paga sin discutir.

### Decisión: sí a la prueba gratis. 30 días, sin tarjeta.

**Los tres competidores relevantes tienen prueba gratis sin tarjeta**: Real
Trends 30 días, ProfitOS 14, Nubimetrics 14. Sellerboard, un mes. No es una
concesión: es el estándar de la categoría, y cobrar desde cero nos pondría en
desventaja sin ninguna contrapartida.

Pero el argumento más fuerte es propio del producto:

> **Nuestro valor es literalmente invisible hasta que la cuenta está conectada y
> los costos cargados.** Antes de eso no tenemos nada que mostrar salvo una
> promesa. La prueba gratis no es marketing, **es la demo** — es la única forma
> de que el vendedor vea su propio número.

Cómo la diseñamos para que no sea regalar producto:

1. **La prueba arranca al conectar Mercado Libre**, no al registrarse. Igual que
   Real Trends. Así el reloj corre sobre un usuario que ya hizo el paso difícil,
   y la prueba misma hace el onboarding.
2. **30 días y no 14.** El vendedor tiene que cargar los costos —es su único
   trabajo manual— y después ver un ciclo completo de ventas. Con 14 días, muchos
   llegan al final sin haber terminado de cargar y se van sin haber visto nunca
   el producto funcionando. Es además lo que hace el líder local.
3. **Sin tarjeta.** Todos lo hacen así; pedirla nos daría una tasa de conversión
   peor sin ninguna ventaja.
4. **La sincronización histórica completa va incluida en la prueba.** El
   momento de "ah, mirá" ocurre cuando ve tres meses de datos, no un día.

Y una cosa que **no** hacemos: nada de plan gratis para siempre. La prueba
termina. Un plan gratis permanente en una categoría con costo de soporte alto es
una forma lenta de morir.

---

## 5. Cómo llegamos a los clientes

**El canal es el boca a boca entre vendedores.** Están agrupados —comunidades,
grupos de WhatsApp, cursos de e-commerce— y se recomiendan herramientas todo el
tiempo. Real Trends creció así y llegó a break-even en 8 meses.

**El gancho es una demostración, no una explicación:**

> *"Conectá tu cuenta y en cinco minutos te digo cuánto ganás de verdad con tu
> producto más vendido. Te apuesto a que es menos de lo que pensás."*

Funciona porque es cierta, es verificable en el momento, y el resultado casi
siempre sorprende.

**Dos canales adicionales a evaluar:**
1. **El Centro de Partners de Mercado Libre.** Real Trends y Nubimetrics están
   ahí. Es distribución con el sello de la plataforma. Hay que averiguar los
   requisitos.
2. **Las calculadoras gratuitas como imán.** Media docena de sitios rankean con
   calculadoras de comisión. Publicar una nuestra —gratis, buena, con la marca—
   captura esa búsqueda y termina en *"esto es una venta hipotética; conectá tu
   cuenta y te calculo las reales"*.

---

## 6. Qué construimos y en qué orden

Prioridad estratégica, no técnica. El detalle de cada ítem está en
[07 · Estado y roadmap](07-estado-y-roadmap.md).

### Ahora — llegar a poder cobrar

1. **Migración 008 + OAuth de Tienda Nube.** Segundo canal: es diferenciación
   real y baja el riesgo de depender de una sola API.
2. **Pantalla de miembros de fidelización.** Hoy el vendedor configura el
   programa a ciegas. El módulo que nos diferencia no puede ser el que menos se
   ve.
3. **Facturación y cobro**: Vercel Pro *(decidido, sin objeciones)*, Supabase
   Pro, integración con Mercado Pago, lógica de escalones y de prueba de 30 días.

### Después — convertir la diferenciación en foso

4. **Medir el retorno del programa de fidelización.** Cuánta facturación vino de
   compradores con cupón. Sin este número, la fidelización es fe; con él, es la
   función que justifica el precio entero.
5. **Facturación ARCA.** Cambia la categoría del producto y es retención pura.
   Hoy en pausa por decisión del dueño del producto.

### Vigilar, no construir todavía

- **Multi-usuario.** ProfitOS lo cobra aparte; nos lo van a pedir cuando el
  cliente tenga un empleado.
- **App móvil.** Real Trends la tiene. Cuesta cara y todavía no sabemos si
  nuestro cliente la quiere.
- **Inventario FIFO.** Es la puerta de entrada al territorio ERP. Entrar ahí es
  una decisión estratégica grande, no una función más.

---

## 7. Cómo sabemos si esto está funcionando

Pocas métricas y honestas. Si mentimos acá, nos mentimos a nosotros.

| Métrica | Por qué esta | Meta inicial |
|---|---|---|
| **Cuentas que terminan de cargar costos** | Es el único trabajo manual y el cuello de botella del valor. Si no cargan costos, el producto no existe para ellos | > 70% de las pruebas |
| **Conversión de prueba a pago** | La medida de si el producto vale plata | `pendiente de definir` |
| **Bajas mensuales** | En una herramienta de datos, irse es más fácil que quedarse | < 5% mensual |
| **Vendedores con fidelización activa** | Si el diferenciador no se usa, no diferencia | > 30% de los pagos |
| **Cupones emitidos que terminan en compra** | La prueba de que el programa devuelve plata | `medir antes de fijar meta` |
| **Números mal calculados reportados por clientes** | Nuestra promesa es la exactitud. Esta métrica tiene que tender a cero y sabotea todo lo demás si no lo hace | 0 |

---

## 8. Riesgos

| Riesgo | Cuán probable | Qué hacemos |
|---|---|---|
| **Real Trends agrega fidelización** | Media | Correr rápido. Tenemos ventaja de tiempo, no de tecnología |
| **Mercado Libre construye rentabilidad nativa** | Baja-media | Les falta el costo de mercadería, que solo lo tiene el vendedor. Es una defensa real pero no eterna. Multicanal y ARCA nos sacan de su alcance |
| **Cambio en la API de Mercado Libre** | Media | Multicanal reduce la dependencia. Tienda Nube es el primer paso |
| **Nos suspenden la cuenta a un cliente por la fidelización** | Baja | Todo el circuito está adentro de ML por diseño, y hay tests que fallan si alguien lo rompe. **No relajar esta regla nunca** |
| **La inflación licúa el precio** | Alta | Revisión trimestral con aviso; escalones por órdenes y no por facturación |
| **Custodia de certificados fiscales (ARCA)** | Media, alto impacto | Decidir si la asumimos o delegamos en un proveedor habilitado, **antes** de escribir el código |

---

## Fuentes

Investigación del 29 de agosto de 2026:

- [Real Trends — Precios](https://www.real-trends.com/ar/precios) · [Herramientas](https://www.real-trends.com/mx/herramientas) · [Centro de ayuda: ¿Cuál es el precio?](http://ayuda.real-trends.com/es/articles/3814739-cual-es-el-precio) · [Centro de Partners de Mercado Libre](https://centrodepartners.mercadolibre.com.ar/apps/real-trends) · [Perfil en Emprelatam](https://blog.emprelatam.com/2019/08/28/real-trends-la-plataforma-lider-en-herramientas-de-analisis-y-gestion-para-vendedores-de-mercado-libre/)
- [ProfitOS](https://www.profitosapp.com/)
- [Nubimetrics](https://landings.nubimetrics.com/) · [Centro de Partners](https://centrodepartners.mercadolibre.com.mx/apps/nubimetrics)
- [Snow Profit](https://snowprofit.com/calculadora-mercadolibre-mexico)
- [sellerboard — análisis de precios](https://vovaeven.com/blog/sellerboard-pricing-price-plans-review) · [planes y prueba](https://revenuegeeks.com/software/sellerboard/pricing)
- Calculadoras gratuitas: [Unidrop](https://www.unidrop.com.ar/calculadora-rentabilidad-mercado-libre) · [DigitalSellers](https://www.digitalsellers.com.ar/simulador/) · [SmartSelling](https://smartselling.app/calculadora/) · [SpomBridge](https://app.spomsolutions.com/herramientas/calculadora-comisiones-mercadolibre)
- [Mercado Libre — Canal de difusión para fidelizar seguidores](https://vendedores.mercadolibre.com.mx/nota/canal-de-difusion-fideliza-seguidores-y-consigue-mas-ventas) · [Programa de recompensas por opinar](https://www.iproup.com/innovacion/63009-mercado-libre-como-ganar-plata-y-descuentos-solo-por-dar-tu-opinion) · [MELI+](https://www.merca20.com/meli-la-estrategioa-de-lealtad-de-mercado-libre/)
- [Panorama de herramientas 2026 — Jaguar Sheet](https://jaguarsheet.com/es/blog/herramientas-vendedores-mercado-libre)
