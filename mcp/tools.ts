import { mlFetch, MlApiError } from "./ml-client";
import { getValidAccessToken } from "./auth";

export interface MlProduct {
  id: string;
  title: string;
  sku: string | null;
  price: number;
  stock: number;
  permalink: string;
  categoryId: string | null;
  categoryName: string | null;
  thumbnail: string | null;
  /** "fulfillment" = está en Mercado Envíos Full. Sin confirmar el nombre
   * exacto del campo contra una respuesta real todavía. */
  logisticType: string | null;
  /** Id para consultar /inventories/{id}/stock/fulfillment. Sin confirmar. */
  inventoryId: string | null;
}

/** Sin confirmar todavía dónde vive exactamente en la respuesta de /items:
 * puede ser la raíz (ítem simple) o cada variación (ítem con variantes). */
function extractLogistics(body: any): { logisticType: string | null; inventoryId: string | null } {
  return {
    logisticType: body?.shipping?.logistic_type ?? null,
    inventoryId: body?.inventory_id ?? body?.variations?.[0]?.inventory_id ?? null,
  };
}

/**
 * Diagnóstico: si hay productos pero NINGUNO trajo `shipping.logistic_type`,
 * el campo real tiene otro nombre o vive en otro lado — se loguean las claves
 * de `shipping` (o su ausencia) del primer producto para corregir con
 * evidencia real en vez de otra suposición sin confirmar.
 */
function warnIfNoLogisticType(bodies: any[]): void {
  if (bodies.length === 0 || bodies.some((b) => b?.shipping?.logistic_type !== undefined)) return;
  const sample = bodies[0] ?? {};
  console.warn(
    `Productos: ${bodies.length} ítem(s) sin 'shipping.logistic_type' reconocible. ` +
    `Claves de 'shipping' del primero: ${Object.keys(sample.shipping ?? {}).join(", ") || "(sin campo 'shipping')"}.`
  );
}

export async function listProducts(accountId: string, sellerId: string): Promise<MlProduct[]> {
  const token = await getValidAccessToken(accountId);
  // No solo "active": una cuenta con historial real de ventas tiene
  // publicaciones pausadas o cerradas cuyas órdenes viejas siguen
  // apareciendo en /orders — si no las traemos acá, esos product_id nunca
  // entran a la tabla products y su costo no se puede cargar nunca.
  // Paginación por `offset` clásica: ML la corta con un 400 ("Invalid limit
  // and offset values") en cuanto offset+limit pasa de 1000, sin importar
  // cuántas publicaciones tenga realmente el vendedor. Un catálogo grande
  // (con historial de pausadas/cerradas incluido) supera eso fácil, y sin
  // esto el sync entero fallaba para esas cuentas. `search_type=scan` es el
  // modo que Mercado Libre da para recorrer más de 1000 resultados: la
  // primera página se pide con los filtros de siempre, y las siguientes solo
  // con el `scroll_id` que devuelve cada respuesta, hasta que no traiga más.
  const SEARCH_PAGE_SIZE = 50;
  const ids: string[] = [];
  let scrollId: string | undefined;
  // Techo de seguridad: si ML alguna vez devolviera el mismo scroll_id sin
  // avanzar, esto corta el sync en vez de colgarlo pidiendo páginas para
  // siempre (con 50 por página, 2000 páginas son 100.000 publicaciones).
  const MAX_SCAN_PAGES = 2000;
  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const url = scrollId
      ? `/users/${sellerId}/items/search?search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
      : `/users/${sellerId}/items/search?status=active,paused,closed&search_type=scan&limit=${SEARCH_PAGE_SIZE}`;
    const search = await mlFetch(url, token);
    const results: string[] = search.results;
    if (results.length === 0) break;
    ids.push(...results);
    scrollId = search.scroll_id;
    if (!scrollId) break;
  }
  if (ids.length === 0) return [];

  // /items?ids= solo acepta 20 ids por llamada — con más de una publicación
  // pausada/cerrada en el historial esto se pasa fácil.
  const ML_ITEMS_BATCH_SIZE = 20;
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ML_ITEMS_BATCH_SIZE) {
    batches.push(ids.slice(i, i + ML_ITEMS_BATCH_SIZE));
  }
  const batchResults = await Promise.all(batches.map((batch) => mlFetch(`/items?ids=${batch.join(",")}`, token)));

  const products: MlProduct[] = [];
  const bodies: any[] = [];
  for (const details of batchResults) {
    for (const entry of details) {
      bodies.push(entry.body);
      products.push({
        id: entry.body.id,
        title: entry.body.title,
        sku: entry.body.seller_custom_field ?? null,
        price: entry.body.price,
        stock: entry.body.available_quantity,
        permalink: entry.body.permalink,
        categoryId: entry.body.category_id ?? null,
        categoryName: null,
        // secure_thumbnail primero: el `thumbnail` a secas viene por http y
        // el navegador lo bloquea como contenido mixto en una página https.
        thumbnail: entry.body.secure_thumbnail ?? entry.body.thumbnail ?? null,
        ...extractLogistics(entry.body),
      });
    }
  }
  warnIfNoLogisticType(bodies);

  await attachCategoryNames(products, token);
  return products;
}

/**
 * Trae publicaciones puntuales por id, sin pasar por el listado del vendedor.
 *
 * Existe por los productos que se vendieron y ya no aparecen en
 * `/users/{id}/items/search` —dados de baja, en revisión, borrados—. Esos no
 * tienen ficha en el catálogo, así que en el panel salían como "MLA2293610632"
 * y sin foto, y no había forma de reconocerlos para cargarles el costo.
 *
 * Tolera que un id no exista: devuelve lo que Mercado Libre sí conteste, en
 * vez de tirar toda la tanda por uno.
 */
export async function getProductsByIds(accountId: string, ids: string[]): Promise<MlProduct[]> {
  if (ids.length === 0) return [];
  const token = await getValidAccessToken(accountId);

  const ML_ITEMS_BATCH_SIZE = 20;
  const products: MlProduct[] = [];
  for (let i = 0; i < ids.length; i += ML_ITEMS_BATCH_SIZE) {
    const batch = ids.slice(i, i + ML_ITEMS_BATCH_SIZE);
    let details: any[];
    try {
      details = await mlFetch(`/items?ids=${batch.join(",")}`, token);
    } catch (err) {
      console.warn(`No se pudieron traer las publicaciones ${batch.join(",")}:`, (err as Error).message);
      continue;
    }
    for (const entry of details ?? []) {
      // /items?ids= devuelve un code por id: los que fallaron vienen con 404
      // y sin body. Se saltean en silencio, no son un error de la tanda.
      if (entry?.code && entry.code !== 200) continue;
      const body = entry?.body;
      if (!body?.id) continue;
      products.push({
        id: body.id,
        title: body.title,
        sku: body.seller_custom_field ?? null,
        price: body.price ?? 0,
        stock: body.available_quantity ?? 0,
        permalink: body.permalink,
        categoryId: body.category_id ?? null,
        categoryName: null,
        thumbnail: body.secure_thumbnail ?? body.thumbnail ?? null,
        ...extractLogistics(body),
      });
    }
  }

  await attachCategoryNames(products, token);
  return products;
}

/**
 * Títulos tal como quedaron registrados en una orden.
 *
 * Último recurso para las publicaciones borradas de Mercado Libre: `/items`
 * ya no las conoce, pero la orden guarda el nombre con el que se vendieron.
 * Sin esto, un producto borrado se queda para siempre como "MLA2293610632" y
 * el vendedor no puede reconocerlo para cargarle el costo.
 *
 * No usa getOrderDetail a propósito: ese además pide el costo del envío, que
 * acá no hace falta.
 */
export async function getOrderItemTitles(accountId: string, orderId: string): Promise<Map<string, string>> {
  const token = await getValidAccessToken(accountId);
  const titles = new Map<string, string>();
  try {
    const order = await mlFetch(`/orders/${orderId}`, token);
    for (const oi of order.order_items ?? []) {
      const id = oi?.item?.id;
      const title = oi?.item?.title;
      if (id && title) titles.set(String(id), String(title));
    }
  } catch (err) {
    console.warn(`No se pudo leer la orden ${orderId} para recuperar títulos:`, (err as Error).message);
  }
  return titles;
}

/**
 * Resuelve el nombre de cada categoría. `/items` solo devuelve el id
 * (ej. "MLA1234"), que no le dice nada a nadie en un gráfico.
 *
 * Se piden solo los ids únicos: un catálogo de 200 publicaciones suele tener
 * un puñado de categorías, así que esto son pocas llamadas y no una por
 * producto. Si alguna falla, ese producto queda sin nombre de categoría en
 * vez de romper la sincronización entera del catálogo.
 */
async function attachCategoryNames(products: MlProduct[], token: string): Promise<void> {
  const uniqueIds = [...new Set(products.map((p) => p.categoryId).filter((id): id is string => Boolean(id)))];
  if (uniqueIds.length === 0) return;

  const names = new Map<string, string>();
  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const category = await mlFetch(`/categories/${id}`, token);
        if (category?.name) names.set(id, String(category.name));
      } catch (err) {
        console.warn(`No se pudo resolver el nombre de la categoría ${id}:`, (err as Error).message);
      }
    })
  );

  for (const p of products) {
    if (p.categoryId) p.categoryName = names.get(p.categoryId) ?? null;
  }
}

export interface MlOrderItem {
  productId: string;
  /**
   * Título tal como quedó registrado en la venta. Es la única forma de saber
   * cómo se llamaba un producto que ya no está publicado: `/users/{id}/items`
   * no lo devuelve más, así que sin esto una venta vieja queda huérfana y el
   * vendedor no tiene dónde cargarle el costo.
   */
  productTitle: string;
  unitPrice: number;
  quantity: number;
  mlCommission: number;
  shippingCost: number;
}

export interface MlOrder {
  id: string;
  dateCreated: string;
  status: string;
  buyerTotal: number;
  items: MlOrderItem[];
}

/**
 * Cuánto le costó el envío al VENDEDOR en una orden.
 *
 * `/orders/{id}` NO trae el costo: su campo `shipping` es solo `{ id }`, el
 * id del envío. El código anterior leía `order.shipping.cost`, que nunca
 * existió — por eso el envío venía siempre en $0 y la ganancia neta salía
 * inflada. El costo real está en `/shipments/{id}/costs`, que separa lo que
 * paga quien despacha (`senders`, o sea el vendedor) de lo que paga el
 * comprador (`receiver`): si el comprador pagó el envío, al vendedor no le
 * cuesta nada y esto devuelve 0 correctamente.
 *
 * Devuelve 0 ante cualquier problema: no tener el dato de envío es mucho
 * mejor que abortar la sincronización entera de la orden.
 */
export async function getShipmentSellerCost(accountId: string, shipmentId: string): Promise<number> {
  const token = await getValidAccessToken(accountId);
  try {
    const costs = await mlFetch(`/shipments/${shipmentId}/costs`, token, {
      headers: { "x-format-new": "true" },
    });

    // Formato nuevo: senders[] (puede haber más de uno en carritos multi-vendedor).
    if (Array.isArray(costs?.senders)) {
      const total = costs.senders.reduce((sum: number, s: any) => sum + Number(s?.cost ?? 0), 0);
      if (Number.isFinite(total)) return total;
    }
    // Formato viejo: costo del vendedor plano.
    for (const candidate of [costs?.sender?.cost, costs?.gross_amount]) {
      const value = Number(candidate);
      if (Number.isFinite(value)) return value;
    }
    // Se loguean las claves (no el body entero, por las dudas) para poder ver
    // la forma real de la respuesta la próxima vez que esto pase — es la
    // sospecha concreta con Fulfillment/Full, que podría devolver un formato
    // distinto a `senders[]` / `sender.cost` / `gross_amount`.
    console.warn(
      `Envío ${shipmentId}: /costs respondió sin costo de vendedor reconocible. Claves recibidas: ${Object.keys(costs ?? {}).join(", ")}`
    );
    return 0;
  } catch (err) {
    // Silenciar esto del todo dejaba el envío en $0 sin ninguna pista de por
    // qué (permisos, endpoint, formato). Se sigue devolviendo 0 para no
    // abortar el sync, pero queda registrado.
    console.warn(`No se pudo obtener el costo del envío ${shipmentId}:`, (err as Error).message);
    return 0;
  }
}

export async function getOrderDetail(accountId: string, orderId: string): Promise<MlOrder> {
  const token = await getValidAccessToken(accountId);
  const order = await mlFetch(`/orders/${orderId}`, token);

  const shipmentId = order.shipping?.id;
  const orderShippingCost = shipmentId ? await getShipmentSellerCost(accountId, String(shipmentId)) : 0;

  // El envío se cobra una vez por ORDEN, no por producto. Antes se copiaba el
  // costo completo en cada línea, así que una orden con 2 productos distintos
  // descontaba el envío dos veces. Se reparte proporcional a lo facturado por
  // línea (y en partes iguales si la orden facturó 0).
  const items = order.order_items ?? [];
  const orderRevenue = items.reduce((sum: number, oi: any) => sum + Number(oi.unit_price) * Number(oi.quantity), 0);

  return {
    id: String(order.id),
    dateCreated: order.date_created,
    status: order.status,
    buyerTotal: order.total_amount,
    items: items.map((oi: any) => {
      const lineRevenue = Number(oi.unit_price) * Number(oi.quantity);
      const share = orderRevenue > 0 ? lineRevenue / orderRevenue : 1 / (items.length || 1);
      return {
        productId: oi.item.id,
        productTitle: String(oi.item.title ?? oi.item.id),
        unitPrice: oi.unit_price,
        quantity: oi.quantity,
        mlCommission: oi.sale_fee ?? 0,
        shippingCost: orderShippingCost * share,
      };
    }),
  };
}

/**
 * Una sola página de órdenes, más el total. El recálculo del historial va por
 * lotes (cada orden cuesta 2 llamadas a la API, así que traerlas todas en un
 * request se pasa del límite de tiempo de la función), y para eso necesita
 * poder pedir "dame las 10 órdenes a partir de la N".
 */
export async function listOrdersPage(
  accountId: string,
  sellerId: string,
  sinceIso: string,
  offset: number,
  limit: number
): Promise<{ ids: string[]; total: number }> {
  const token = await getValidAccessToken(accountId);
  const search = await mlFetch(
    `/orders/search?seller=${sellerId}&order.date_created.from=${sinceIso}&limit=${limit}&offset=${offset}`,
    token
  );
  const results: any[] = search.results ?? [];
  return {
    ids: results.map((o: any) => String(o.id)),
    total: search.paging?.total ?? offset + results.length,
  };
}

export async function listOrders(accountId: string, sellerId: string, sinceIso: string): Promise<string[]> {
  const token = await getValidAccessToken(accountId);
  // /orders/search pagina de a 50 por defecto. Sin recorrer las páginas, un
  // sync completo del historial se cortaba en las primeras 50 órdenes.
  const PAGE_SIZE = 50;
  const ids: string[] = [];
  let offset = 0;
  while (true) {
    const search = await mlFetch(
      `/orders/search?seller=${sellerId}&order.date_created.from=${sinceIso}&limit=${PAGE_SIZE}&offset=${offset}`,
      token
    );
    const page: any[] = search.results ?? [];
    ids.push(...page.map((o: any) => String(o.id)));
    offset += page.length;
    const total = search.paging?.total ?? offset;
    if (page.length === 0 || offset >= total) break;
  }
  return ids;
}

// Product Ads cuelga de un "advertiser" propio, no directo del seller.
// El endpoint viejo /advertising/product_ads/campaigns (plano) y el
// siguiente intento /advertising/advertisers/{id}/product_ads/campaigns
// (sin site_id) dan ambos 404: Mercado Libre migró Product Ads a una versión
// nueva en 2025 bajo /marketplace/advertising/{site_id}/advertisers/{id}/...
// que además requiere el header Api-Version. Devuelve null si la cuenta no
// tiene Product Ads habilitado (nunca creó una campaña).
export async function getAdvertiserId(accountId: string): Promise<{ advertiserId: string; siteId: string } | null> {
  const token = await getValidAccessToken(accountId);
  const res = await mlFetch(`/advertising/advertisers?product_id=PADS`, token);
  const advertiser = (res.advertisers ?? [])[0];
  return advertiser ? { advertiserId: String(advertiser.advertiser_id), siteId: String(advertiser.site_id) } : null;
}

function productAdsBase(siteId: string, advertiserId: string) {
  return `/marketplace/advertising/${siteId}/advertisers/${advertiserId}/product_ads`;
}

/**
 * Product Ads rechaza con 400 (`invalid_request_param`) cualquier consulta con
 * más de 90 días entre date_from y date_to. Por eso las campañas no cargaban:
 * se pedía un año entero de una.
 */
/**
 * Ventana de días por consulta a Product Ads.
 *
 * La API dice "no más de 90 días", pero rechazó un rango de 90 días contados
 * de punta a punta (2020-01-01 a 2020-03-30): no queda claro si mide el
 * intervalo o los días inclusive. En vez de afinar el borde a ciegas se deja
 * margen — sobre un historial de seis años son tres pedidos más, y el
 * problema desaparece del todo en vez de reaparecer en un año bisiesto.
 */
const PRODUCT_ADS_MAX_DAYS = 80;

function dateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Parte [from, to] en tramos de como mucho 90 días. */
export function splitIntoWindows(from: string, to: string, maxDays = PRODUCT_ADS_MAX_DAYS): { from: string; to: string }[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const windows: { from: string; to: string }[] = [];
  let cursor = start;
  while (cursor <= end) {
    const windowEnd = new Date(Math.min(cursor.getTime() + (maxDays - 1) * 86400000, end.getTime()));
    windows.push({ from: dateStr(cursor), to: dateStr(windowEnd) });
    cursor = new Date(windowEnd.getTime() + 86400000);
  }
  return windows;
}

/**
 * Un 404 al *listar* campañas no es un error: Mercado Libre responde
 * `advertiser_campaigns_not_found` cuando el advertiser existe pero todavía
 * no creó ninguna campaña. Mostrarlo como error rojo hacía parecer rota una
 * cuenta que simplemente no usa Product Ads.
 */
async function listOrEmpty<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MlApiError && err.status === 404) return fallback;
    throw err;
  }
}

/**
 * Cuántos días para atrás sirve métricas Mercado Ads. Con margen sobre los 90
 * que documenta la API: pedir justo el borde ya devolvió 400.
 */
export const ADS_LOOKBACK_DAYS = 85;

/**
 * Adelanta la fecha de inicio hasta donde la API puede contestar.
 *
 * `today` existe para poder testear sin depender del reloj.
 */
export function clampToAdsWindow(dateFrom: string, today = new Date()): string {
  const limit = new Date(today.getTime() - ADS_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  return dateFrom < limit ? limit : dateFrom;
}

function eachDateInRange(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
    days.push(dateStr(cursor));
  }
  return days;
}

export async function getAdsSpend(
  accountId: string,
  sellerId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ productId: string | null; date: string; amount: number }[]> {
  const advertiser = await getAdvertiserId(accountId);
  if (!advertiser) return [];

  const token = await getValidAccessToken(accountId);
  const base = productAdsBase(advertiser.siteId, advertiser.advertiserId);

  // Mercado Ads solo sirve métricas de los últimos 90 días CORRIDOS: el límite
  // es hacia atrás desde hoy, no del largo del rango. Un sync del historial
  // pedía desde 2020 y se comía un 400 en cada tramo viejo, así que la
  // publicidad no entraba nunca. Se recorta el pedido a lo que la API puede
  // contestar; lo anterior no existe del lado de ML y no hay forma de traerlo.
  const from = clampToAdsWindow(dateFrom);
  if (from > dateTo) return [];

  const rows: { productId: string | null; date: string; amount: number }[] = [];
  for (const window of splitIntoWindows(from, dateTo)) {
    const campaigns = await listOrEmpty(
      () =>
        mlFetch(
          `${base}/campaigns/search?date_from=${window.from}&date_to=${window.to}&metrics=cost`,
          token,
          { headers: { "Api-Version": "2" } }
        ),
      { results: [] }
    );
    const results = campaigns.results ?? [];

    // Confirmado con un log real de producción (no era una suposición: la
    // primera versión asumía "metrics_by_day" y nunca trajo nada). Cada
    // campaña trae "metrics: { cost }", un total agregado de TODO el rango
    // pedido — ML no lo abre por día ni por publicación acá. Sin esa
    // discriminación, se reparte el total en partes iguales entre los días
    // del rango y se guarda a nivel cuenta (product_id null), igual que la
    // publicidad que se carga a mano: entra al Ad Spend/MER/ROAS de la
    // cuenta, pero por ahora no se puede descontar de la ganancia neta de
    // una venta puntual — no hay forma de saber qué publicación generó ese
    // gasto.
    const totalCost = results.reduce((sum: number, c: any) => sum + Number(c.metrics?.cost ?? 0), 0);
    if (totalCost > 0) {
      const days = eachDateInRange(window.from, window.to);
      const perDay = totalCost / days.length;
      for (const day of days) {
        rows.push({ productId: null, date: day, amount: perDay });
      }
    }

    // Diagnóstico: si hay campañas en el rango pero ninguna trae un costo
    // numérico, la API volvió a cambiar de forma. Se loguean nada más que los
    // NOMBRES de los campos (no montos ni textos) para corregir con evidencia
    // real en vez de otra suposición.
    const noneHasCost = results.length > 0 && results.every((c: any) => typeof c.metrics?.cost !== "number");
    if (noneHasCost) {
      const sample = results[0] ?? {};
      console.warn(
        `Product Ads: ${results.length} campaña(s) en ${window.from}..${window.to} sin gasto reconocible. ` +
        `Claves de la primera campaña: ${Object.keys(sample).join(", ")}.`
      );
    }
  }
  return rows;
}

export interface MlCampaign {
  id: string;
  name: string;
  status: string;
  budget: number;
}

export async function listCampaigns(accountId: string): Promise<MlCampaign[]> {
  const advertiser = await getAdvertiserId(accountId);
  if (!advertiser) return [];

  const token = await getValidAccessToken(accountId);
  // Los últimos 90 días, que es el máximo que acepta la API. Acá solo se
  // listan las campañas para poder pausarlas o reactivarlas, así que la
  // ventana no cambia qué campañas aparecen.
  const dateTo = dateStr(new Date());
  const dateFrom = dateStr(new Date(Date.now() - (PRODUCT_ADS_MAX_DAYS - 1) * 86400000));
  const res = await listOrEmpty(
    () =>
      mlFetch(
        `${productAdsBase(advertiser.siteId, advertiser.advertiserId)}/campaigns/search?date_from=${dateFrom}&date_to=${dateTo}`,
        token,
        { headers: { "Api-Version": "2" } }
      ),
    { results: [] }
  );
  return (res.results ?? []).map((c: any) => ({
    id: String(c.id),
    name: c.name,
    status: c.status,
    budget: c.budget,
  }));
}

// Requiere el scope "Write". Solo cambia el estado de una campaña que ya
// existe (pausar/reactivar) — no crea campañas nuevas ni toca presupuestos.
export async function setCampaignStatus(accountId: string, campaignId: string, status: "active" | "paused"): Promise<void> {
  const advertiser = await getAdvertiserId(accountId);
  if (!advertiser) {
    throw new MlApiError(404, "No se encontró un advertiser de Product Ads para esta cuenta.");
  }
  const token = await getValidAccessToken(accountId);
  await mlFetch(`${productAdsBase(advertiser.siteId, advertiser.advertiserId)}/campaigns/${campaignId}`, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Api-Version": "2" },
    body: JSON.stringify({ status }),
  });
}

export interface MlQuestion {
  id: number;
  productId: string;
  text: string;
  dateCreated: string;
}

export async function listUnansweredQuestions(accountId: string, sellerId: string): Promise<MlQuestion[]> {
  const token = await getValidAccessToken(accountId);
  const search = await mlFetch(
    `/questions/search?seller_id=${sellerId}&status=UNANSWERED&sort_fields=date_created&sort_types=DESC`,
    token
  );
  return (search.questions ?? []).map((q: any) => ({
    id: q.id,
    productId: q.item_id,
    text: q.text,
    dateCreated: q.date_created,
  }));
}

// Requiere que la app tenga habilitado el scope "Write" en developers.mercadolibre.com
// — con solo "Read" (el que usa el resto de esta app) esto devuelve 403.
export async function answerQuestion(accountId: string, questionId: number, text: string): Promise<void> {
  const token = await getValidAccessToken(accountId);
  await mlFetch(`/answers`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_id: questionId, text }),
  });
}

// También requiere el scope "Write". Escribe directo sobre la publicación en vivo
// del vendedor — a diferencia del resto de la app (que es de solo lectura), un
// error acá modifica precio/stock reales en Mercado Libre.
export async function updateProductPriceStock(
  accountId: string,
  itemId: string,
  updates: { price?: number; stock?: number }
): Promise<void> {
  const token = await getValidAccessToken(accountId);
  const body: Record<string, number> = {};
  if (updates.price !== undefined) body.price = updates.price;
  if (updates.stock !== undefined) body.available_quantity = updates.stock;
  await mlFetch(`/items/${itemId}`, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Visitas a las publicaciones del vendedor en un rango de fechas.
 *
 * Devuelve null (y no 0) si Mercado Libre no da el dato: 0 visitas y "no
 * sabemos" son cosas distintas, y mostrar 0 haría ver una conversión
 * imposible.
 */
export async function getStoreVisits(
  accountId: string,
  sellerId: string,
  dateFrom: string,
  dateTo: string
): Promise<number | null> {
  const token = await getValidAccessToken(accountId);
  // Iteración número dos de este mismo bug: primero se mandaba un timestamp
  // completo con "-00:00" (rechazado), después con "Z" (rechazado
  // IGUAL — confirmado en logs reales de producción). El problema nunca fue
  // el offset: la documentación oficial de ML muestra el ejemplo con fecha
  // simple ("date_from=2021-01-01"), no un timestamp con hora. El endpoint
  // quiere YYYY-MM-DD a secas, que es exactamente lo que ya traen
  // dateFrom/dateTo — no hay que armar nada encima.
  try {
    const res = await mlFetch(
      `/users/${sellerId}/items_visits?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
      token
    );
    const total = Number(res?.total_visits);
    return Number.isFinite(total) ? total : null;
  } catch (err) {
    console.warn("No se pudieron obtener las visitas:", (err as Error).message);
    return null;
  }
}

/**
 * Sonda de diagnóstico para "facturas vencidas": `/users/{id}/restrictions`
 * apareció mencionado en una investigación externa (no oficial, sin
 * confirmar) como el lugar donde ML avisaría una restricción por deuda de
 * facturación. En vez de construir una funcionalidad entera sobre un
 * endpoint sin confirmar, esto llama y devuelve la FORMA de la respuesta
 * (si existe, si es array u objeto, y sus claves) para decidir con
 * evidencia real si vale la pena seguir por acá.
 */
export async function probeAccountRestrictions(
  accountId: string,
  sellerId: string
): Promise<{ ok: true; isArray: boolean; length: number | null; sampleKeys: string[] } | { ok: false; error: string }> {
  const token = await getValidAccessToken(accountId);
  try {
    const res = await mlFetch(`/users/${sellerId}/restrictions`, token);
    const isArray = Array.isArray(res);
    const sample = isArray ? res[0] : res;
    return {
      ok: true,
      isArray,
      length: isArray ? res.length : null,
      sampleKeys: sample && typeof sample === "object" ? Object.keys(sample) : [],
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── API de facturación de Mercado Libre ──────────────────────────────────
// Fuente de verdad de lo que ML EFECTIVAMENTE cobró (comisiones, envíos,
// percepciones impositivas, Product Ads), a diferencia del resto de la app
// que lo estima a partir de cada orden. Sirve para conciliar.

export interface MlBillingPeriod {
  /** Siempre el primer día del mes: "2026-08-01". */
  key: string;
  dateFrom: string | null;
  dateTo: string | null;
  amount: number;
  /** OPEN = todavía se están acumulando cargos; CLOSED = período cerrado.
   * No es lo mismo que "pagado": ML no expone ese estado acá. */
  periodStatus: string | null;
}

export interface MlBillingCharge {
  detailId: string;
  periodKey: string;
  detailType: string | null;
  detailSubType: string | null;
  concept: string | null;
  orderId: string | null;
  amount: number;
  chargedAt: string | null;
}

export async function listBillingPeriods(accountId: string): Promise<MlBillingPeriod[]> {
  const token = await getValidAccessToken(accountId);
  const res = await listOrEmpty(
    // document_type es obligatorio: sin él ML responde 422 y la conciliación
    // quedaba vacía en silencio. BILL son los cargos; CREDIT_NOTE, las notas
    // de crédito, que no entran en esta vista.
    () => mlFetch(`/billing/integration/monthly/periods?group=ML&document_type=BILL&offset=0&limit=12`, token),
    { results: [] }
  );
  const rows = res.results ?? res.periods ?? [];
  return rows.map((p: any) => ({
    key: String(p.key ?? p.period?.date_from ?? "").slice(0, 10),
    dateFrom: p.period?.date_from ?? null,
    dateTo: p.period?.date_to ?? null,
    amount: Number(p.amount ?? 0),
    periodStatus: p.period_status ?? null,
  })).filter((p: MlBillingPeriod) => p.key);
}

/**
 * Detalle de cargos de un período. Se pagina con `from_id` hasta que ML deja
 * de devolver resultados; el tope de vueltas evita un loop infinito si la API
 * ignora el cursor.
 */
export async function getBillingCharges(accountId: string, periodKey: string): Promise<MlBillingCharge[]> {
  const token = await getValidAccessToken(accountId);
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const charges: MlBillingCharge[] = [];
  let fromId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ document_type: "BILL", limit: String(PAGE_SIZE) });
    if (fromId) query.set("from_id", fromId);
    const res: any = await listOrEmpty(
      () => mlFetch(`/billing/integration/periods/key/${periodKey}/group/ML/details?${query}`, token),
      { results: [] }
    );
    const rows: any[] = res.results ?? res.details ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      charges.push({
        detailId: String(row.detail_id ?? row.id),
        periodKey,
        detailType: row.detail_type ?? null,
        detailSubType: row.detail_sub_type ?? null,
        concept: row.concept ?? row.detail_sub_type ?? row.detail_type ?? null,
        // ML nombra este campo distinto según el tipo de cargo; el primero que
        // exista es el que ata el cargo a una venta nuestra.
        orderId: firstDefined(row.order_id, row.transaction_detail?.order_id, row.sales_info?.order_id),
        amount: Number(row.detail_amount ?? row.charge_amount ?? row.amount ?? 0),
        chargedAt: row.creation_date_time ?? row.date_created ?? null,
      });
    }

    const last = rows[rows.length - 1];
    const nextId = last?.detail_id ?? last?.id;
    if (!nextId || rows.length < PAGE_SIZE) break;
    fromId = String(nextId);
  }

  return charges;
}

function firstDefined(...values: unknown[]): string | null {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).length > 0) return String(v);
  }
  return null;
}

// ── Cupones del vendedor ─────────────────────────────────────────────────

export interface SellerCouponInput {
  name: string;
  /** Descuento en pesos. */
  amount: number;
  /** Compra mínima para poder usarlo. */
  minPurchase: number;
  /** Presupuesto total de la campaña: tope de lo que ML puede descontar. */
  budget: number;
  /** Días de vigencia desde hoy. */
  durationDays: number;
}

export interface SellerCoupon {
  id: string;
  /** Código que el comprador ingresa al pagar. */
  code: string | null;
  status: string;
}

/**
 * Crea un cupón oficial de Mercado Libre.
 *
 * Es la pieza que cierra el programa de fidelización: el premio no es un
 * "punto" nuestro sino un descuento real, emitido y respetado por ML, que el
 * comprador usa sin salir de la plataforma. Por eso el programa no puede ser
 * interpretado como desvío de tráfico.
 *
 * El presupuesto es un tope duro: ML deja de aplicar el cupón cuando se agota,
 * así que un error de configuración no puede vaciar la caja del vendedor.
 */
export async function createSellerCoupon(accountId: string, input: SellerCouponInput): Promise<SellerCoupon> {
  const token = await getValidAccessToken(accountId);
  const start = new Date();
  const finish = new Date(start.getTime() + input.durationDays * 86400000);

  const res = await mlFetch(`/seller-promotions/promotions`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      promotion_type: "SELLER_COUPON_CAMPAIGN",
      name: input.name,
      start_date: start.toISOString(),
      finish_date: finish.toISOString(),
      fixed_amount: input.amount,
      min_purchase_amount: input.minPurchase,
      budget: input.budget,
    }),
  });

  return {
    id: String(res.id ?? res.promotion_id ?? ""),
    code: res.coupon_code ?? res.code ?? null,
    status: res.status ?? "unknown",
  };
}

// ── Stock en Mercado Envíos Full ──────────────────────────────────────────
// Para "valorización de stock en Full": cuánto capital hay inmovilizado en
// mercadería guardada en los depósitos de ML (cantidad × costo cargado).

export interface MlFullStock {
  inventoryId: string;
  availableQuantity: number;
  unavailableQuantity: number;
}

/**
 * Trae el stock guardado en Full de una lista de inventory_id.
 *
 * Sin confirmar contra una respuesta real: no hay evidencia de que este
 * endpoint acepte multi-get (varios ids separados por coma) como sí lo
 * aceptan otros de esta API, así que se pide de a uno. Si una cuenta llega a
 * tener cientos de productos en Full esto puede ser lento — no hay urgencia
 * en optimizarlo hasta confirmar que el patrón de a uno es correcto.
 */
export async function getFullStock(accountId: string, inventoryIds: string[]): Promise<MlFullStock[]> {
  if (inventoryIds.length === 0) return [];
  const token = await getValidAccessToken(accountId);

  const results: MlFullStock[] = [];
  let unrecognized = 0;
  let sample: any = null;

  // Por ítem, no por tanda: un solo inventory_id que falle (rate limit, 500
  // pasajero) no puede tirar abajo el stock de los otros 49 que sí
  // contestaron bien. Un 404 es normal (todavía no tiene stock ahí); otro
  // error se loguea, pero tampoco frena al resto.
  await Promise.all(
    inventoryIds.map(async (inventoryId) => {
      let res: any;
      try {
        res = await mlFetch(`/inventories/${inventoryId}/stock/fulfillment`, token);
      } catch (err) {
        if (!(err instanceof MlApiError && err.status === 404)) {
          console.warn(`No se pudo traer el stock de Full de ${inventoryId}:`, (err as Error).message);
        }
        return;
      }
      if (typeof res.available_quantity !== "number") {
        unrecognized += 1;
        sample = sample ?? res;
        return;
      }
      results.push({
        inventoryId,
        availableQuantity: res.available_quantity,
        unavailableQuantity: Number(res.not_available_quantity ?? 0),
      });
    })
  );

  // Diagnóstico: si NINGUNO de los inventory_id consultados trajo un
  // 'available_quantity' reconocible, el nombre real del campo es otro —
  // mismo criterio que con publicidad, se loguean las claves reales en vez
  // de adivinar de nuevo.
  if (unrecognized > 0 && results.length === 0) {
    console.warn(
      `Full: ${unrecognized} inventory_id(s) consultados sin 'available_quantity' reconocible. ` +
      `Claves de la respuesta: ${Object.keys(sample ?? {}).join(", ") || "(respuesta vacía)"}.`
    );
  }

  return results;
}
