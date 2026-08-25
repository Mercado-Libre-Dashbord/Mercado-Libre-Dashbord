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
}

export async function listProducts(accountId: string, sellerId: string): Promise<MlProduct[]> {
  const token = await getValidAccessToken(accountId);
  // No solo "active": una cuenta con historial real de ventas tiene
  // publicaciones pausadas o cerradas cuyas órdenes viejas siguen
  // apareciendo en /orders — si no las traemos acá, esos product_id nunca
  // entran a la tabla products y su costo no se puede cargar nunca.
  const SEARCH_PAGE_SIZE = 50;
  const ids: string[] = [];
  let offset = 0;
  while (true) {
    const search = await mlFetch(
      `/users/${sellerId}/items/search?status=active,paused,closed&limit=${SEARCH_PAGE_SIZE}&offset=${offset}`,
      token
    );
    const page: string[] = search.results;
    ids.push(...page);
    offset += page.length;
    const total = search.paging?.total ?? offset;
    if (page.length === 0 || offset >= total) break;
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
  for (const details of batchResults) {
    for (const entry of details) {
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
      });
    }
  }

  await attachCategoryNames(products, token);
  return products;
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
    console.warn(`Envío ${shipmentId}: /costs respondió sin costo de vendedor reconocible.`);
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
async function getAdvertiserId(accountId: string): Promise<{ advertiserId: string; siteId: string } | null> {
  const token = await getValidAccessToken(accountId);
  const res = await mlFetch(`/advertising/advertisers?product_id=PADS`, token);
  const advertiser = (res.advertisers ?? [])[0];
  return advertiser ? { advertiserId: String(advertiser.advertiser_id), siteId: String(advertiser.site_id) } : null;
}

function productAdsBase(siteId: string, advertiserId: string) {
  return `/marketplace/advertising/${siteId}/advertisers/${advertiserId}/product_ads`;
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

export async function getAdsSpend(
  accountId: string,
  sellerId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ productId: string; date: string; amount: number }[]> {
  const advertiser = await getAdvertiserId(accountId);
  if (!advertiser) return [];

  const token = await getValidAccessToken(accountId);
  const campaigns = await listOrEmpty(
    () =>
      mlFetch(
        `${productAdsBase(advertiser.siteId, advertiser.advertiserId)}/campaigns/search?date_from=${dateFrom}&date_to=${dateTo}&metrics=cost`,
        token,
        { headers: { "Api-Version": "2" } }
      ),
    { results: [] }
  );
  const rows: { productId: string; date: string; amount: number }[] = [];
  for (const c of campaigns.results ?? []) {
    for (const metric of c.metrics_by_day ?? []) {
      rows.push({ productId: metric.item_id, date: metric.date, amount: metric.cost });
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
  // Rango amplio: esto solo lista campañas (para mostrarlas y poder
  // pausarlas/reactivarlas), no depende de que hayan tenido gasto reciente.
  const dateTo = new Date().toISOString().slice(0, 10);
  const dateFrom = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
    () => mlFetch(`/billing/integration/monthly/periods?group=ML&offset=0&limit=12`, token),
    { results: [] }
  );
  const rows = res.results ?? res.periods ?? [];
  return rows.map((p: any) => ({
    key: String(p.key ?? p.period?.date_from ?? "").slice(0, 10),
    dateFrom: p.period?.date_from ?? null,
    dateTo: p.period?.date_to ?? null,
    amount: Number(p.amount ?? 0),
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
