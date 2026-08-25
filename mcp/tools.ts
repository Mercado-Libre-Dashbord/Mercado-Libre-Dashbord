import { mlFetch } from "./ml-client";
import { getValidAccessToken } from "./auth";

export interface MlProduct {
  id: string;
  title: string;
  sku: string | null;
  price: number;
  stock: number;
  permalink: string;
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
      });
    }
  }
  return products;
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

export async function getOrderDetail(accountId: string, orderId: string): Promise<MlOrder> {
  const token = await getValidAccessToken(accountId);
  const order = await mlFetch(`/orders/${orderId}`, token);
  const shippingCost = order.shipping?.cost ?? 0;
  return {
    id: String(order.id),
    dateCreated: order.date_created,
    status: order.status,
    buyerTotal: order.total_amount,
    items: order.order_items.map((oi: any) => ({
      productId: oi.item.id,
      unitPrice: oi.unit_price,
      quantity: oi.quantity,
      mlCommission: oi.sale_fee ?? 0,
      shippingCost,
    })),
  };
}

export async function listOrders(accountId: string, sellerId: string, sinceIso: string): Promise<string[]> {
  const token = await getValidAccessToken(accountId);
  const search = await mlFetch(`/orders/search?seller=${sellerId}&order.date_created.from=${sinceIso}`, token);
  return search.results.map((o: any) => String(o.id));
}

export async function getAdsSpend(
  accountId: string,
  sellerId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ productId: string; date: string; amount: number }[]> {
  const token = await getValidAccessToken(accountId);
  const campaigns = await mlFetch(
    `/advertising/product_ads/campaigns?date_from=${dateFrom}&date_to=${dateTo}`,
    token
  );
  const rows: { productId: string; date: string; amount: number }[] = [];
  for (const c of campaigns.results ?? []) {
    for (const metric of c.metrics_by_day ?? []) {
      rows.push({ productId: metric.item_id, date: metric.date, amount: metric.cost });
    }
  }
  return rows;
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
