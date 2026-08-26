import type { ChannelOrder, ChannelProduct, SalesChannel } from "./types";

const API_VERSION = "2025-03";
const BASE = "https://api.tiendanube.com";

/**
 * Adaptador de Tienda Nube (Nuvemshop).
 *
 * Diferencias con Mercado Libre que conviene tener presentes:
 * - El token de acceso NO expira y no hay refresh: se guarda una vez.
 * - La autenticación va en `Authentication: bearer <token>` (así, sin la "o"
 *   de "Authorization"), que es una particularidad de esta API.
 * - Exige un User-Agent identificando la app; sin él responde 400.
 * - No hay comisión de plataforma: Tienda Nube cobra por suscripción, no por
 *   venta. Por eso platformFee va en 0 y no es un dato faltante.
 */
export class TiendaNubeChannel implements SalesChannel {
  readonly id = "tiendanube" as const;

  constructor(
    private readonly credentials: (accountId: string) => Promise<{ storeId: string; accessToken: string }>,
    private readonly userAgent = "MetricsField Retail (soporte@metricsfield.com)"
  ) {}

  private async request<T>(accountId: string, path: string, init: RequestInit = {}): Promise<T> {
    const { storeId, accessToken } = await this.credentials(accountId);
    const res = await fetch(`${BASE}/${API_VERSION}/${storeId}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authentication: `bearer ${accessToken}`,
        "User-Agent": this.userAgent,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`Tienda Nube ${res.status} en ${path}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async listProducts(accountId: string): Promise<ChannelProduct[]> {
    const PAGE_SIZE = 200;
    const products: ChannelProduct[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.request<any[]>(accountId, `/products?per_page=${PAGE_SIZE}&page=${page}`);
      if (batch.length === 0) break;
      for (const p of batch) {
        // Una publicación de Tienda Nube puede tener varias variantes, cada
        // una con su precio y su stock. Se toma la primera como
        // representativa: el dashboard razona por publicación, no por talle.
        const variant = p.variants?.[0] ?? {};
        products.push({
          id: String(p.id),
          title: typeof p.name === "string" ? p.name : p.name?.es ?? p.name?.pt ?? "",
          sku: variant.sku ?? null,
          price: Number(variant.price ?? 0),
          stock: Number(variant.stock ?? 0),
          permalink: p.canonical_url ?? "",
          categoryId: p.categories?.[0]?.id ? String(p.categories[0].id) : null,
          categoryName: p.categories?.[0]?.name?.es ?? p.categories?.[0]?.name ?? null,
          thumbnail: p.images?.[0]?.src ?? null,
        });
      }
      if (batch.length < PAGE_SIZE) break;
    }
    return products;
  }

  async listOrdersPage(accountId: string, sinceIso: string, offset: number, limit: number) {
    // Tienda Nube pagina por número de página, no por offset arbitrario, así
    // que se traduce. Con limit fijo por lote la cuenta es exacta.
    const page = Math.floor(offset / limit) + 1;
    const batch = await this.request<any[]>(
      accountId,
      `/orders?created_at_min=${encodeURIComponent(sinceIso)}&per_page=${limit}&page=${page}`
    );
    const ids = batch.map((o) => String(o.id));
    // La API no devuelve el total en el cuerpo; se infiere que hay más
    // mientras la página venga completa.
    const total = ids.length === limit ? offset + ids.length + 1 : offset + ids.length;
    return { ids, total };
  }

  async getOrder(accountId: string, orderId: string): Promise<ChannelOrder> {
    const order = await this.request<any>(accountId, `/orders/${orderId}`);

    const items = order.products ?? [];
    const revenue = items.reduce((sum: number, it: any) => sum + Number(it.price) * Number(it.quantity), 0);
    // El envío se cobra una vez por orden: se reparte proporcional a lo
    // facturado por línea, igual que en Mercado Libre.
    const shippingCost = Number(order.shipping_cost_owner ?? 0);

    return {
      id: String(order.id),
      dateCreated: order.created_at,
      status: normalizeStatus(order),
      buyerTotal: Number(order.total ?? 0),
      buyer: {
        docNumber: order.customer?.identification ?? null,
        name: order.customer?.name ?? null,
        email: order.customer?.email ?? null,
      },
      items: items.map((it: any) => {
        const line = Number(it.price) * Number(it.quantity);
        const share = revenue > 0 ? line / revenue : 1 / (items.length || 1);
        return {
          productId: String(it.product_id),
          unitPrice: Number(it.price),
          quantity: Number(it.quantity),
          // Tienda Nube cobra suscripción, no comisión por venta.
          platformFee: 0,
          shippingCost: shippingCost * share,
        };
      }),
    };
  }
}

/**
 * Traduce los estados de Tienda Nube a los tres que le importan al dashboard.
 * Una orden cancelada o con el pago rechazado no es facturación, igual que en
 * Mercado Libre (ver lib/order-status.ts).
 */
export function normalizeStatus(order: { status?: string; payment_status?: string }): ChannelOrder["status"] {
  if (order.status === "cancelled") return "cancelled";
  if (order.payment_status === "paid") return "paid";
  return "pending";
}
