/**
 * Contrato que tiene que cumplir cualquier canal de venta (Mercado Libre,
 * Tienda Nube, una tienda propia).
 *
 * Existe para que el sync deje de asumir que hay un solo canal. Todo lo que
 * el dashboard necesita saber de una venta —qué se vendió, a cuánto, qué se
 * llevó la plataforma, qué costó el envío— cabe acá; lo que cada API tiene de
 * particular queda del lado del adaptador.
 */

export type ChannelId = "mercado_libre" | "tiendanube";

export const CHANNEL_LABEL: Record<ChannelId, string> = {
  mercado_libre: "Mercado Libre",
  tiendanube: "Tienda Nube",
};

export interface ChannelProduct {
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

export interface ChannelOrderItem {
  productId: string;
  unitPrice: number;
  quantity: number;
  /** Comisión que cobra la plataforma. 0 en una tienda propia. */
  platformFee: number;
  /** Costo de envío que paga el VENDEDOR, ya prorrateado por línea. */
  shippingCost: number;
}

export interface ChannelOrder {
  id: string;
  dateCreated: string;
  /** Estado normalizado: cada canal tiene los suyos y el adaptador traduce. */
  status: "paid" | "pending" | "cancelled";
  buyerTotal: number;
  items: ChannelOrderItem[];
  /** Datos para facturar, si el canal los expone. */
  buyer?: {
    docNumber: string | null;
    name: string | null;
    email: string | null;
  };
}

export interface SalesChannel {
  readonly id: ChannelId;
  listProducts(accountId: string): Promise<ChannelProduct[]>;
  /** Una página de órdenes, para poder sincronizar por lotes. */
  listOrdersPage(
    accountId: string,
    sinceIso: string,
    offset: number,
    limit: number
  ): Promise<{ ids: string[]; total: number }>;
  getOrder(accountId: string, orderId: string): Promise<ChannelOrder>;
}
