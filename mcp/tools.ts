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
  const search = await mlFetch(`/users/${sellerId}/items/search?status=active,paused,closed`, token);
  const ids: string[] = search.results;
  if (ids.length === 0) return [];
  const details = await mlFetch(`/items?ids=${ids.join(",")}`, token);
  return details.map((entry: any) => ({
    id: entry.body.id,
    title: entry.body.title,
    sku: entry.body.seller_custom_field ?? null,
    price: entry.body.price,
    stock: entry.body.available_quantity,
    permalink: entry.body.permalink,
  }));
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
