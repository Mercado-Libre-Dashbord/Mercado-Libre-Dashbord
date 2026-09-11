/**
 * El recibo de una venta: de los pesos que pagó el comprador, cuáles se
 * fueron en qué y cuántos quedaron.
 *
 * En Mercado Libre nunca queda claro cuánto se descuenta por comisión y
 * cuánto por envío hasta que la plata ya se liquidó, y en productos de ticket
 * bajo la suma de las dos cosas se come el margen entero sin que nadie lo
 * note. Esto arma la cuenta línea por línea para que se vea.
 *
 * Es lógica pura: recibe números ya sumados y devuelve el desglose. Lo caro
 * de equivocarse acá no es el SQL, es el orden y el signo de los términos, y
 * eso se prueba sin base.
 */

export type ReceiptLineKind = "ingreso" | "costo";

export interface ReceiptLine {
  label: string;
  /** Siempre positivo: el signo lo da `kind`, no el número. */
  amount: number;
  kind: ReceiptLineKind;
  /** Sobre la venta, para poder leer "la comisión se lleva el 13%". */
  share: number;
}

export interface OrderReceiptInput {
  orderId: string;
  date: string;
  /** Lo que pagó el comprador por esta orden, con IVA. */
  revenue: number;
  mlCommission: number;
  shippingCost: number;
  adsCost: number;
  /** Costo del producto ya multiplicado por las unidades. */
  productCost: number;
  /** Otros impuestos cargados por producto (IIBB, internos). */
  otherTax: number;
  iva: number;
  /**
   * Si a alguna línea de la orden todavía le falta el costo cargado. Con esto
   * en true el margen no se calcula: mostrar uno inflado por un costo que
   * vale cero es peor que no mostrar nada.
   */
  costMissing: boolean;
  /** Lo que ML efectivamente facturó por esta orden, si ya está en la factura. */
  realMlCharges?: number | null;
}

export type ReceiptWarning = "margen_negativo" | "sin_costo" | null;

export interface OrderReceipt {
  orderId: string;
  date: string;
  revenue: number;
  lines: ReceiptLine[];
  /** Null cuando falta cargar algún costo. */
  netMargin: number | null;
  /** Fracción sobre la venta: 0.18 = 18%. Null por el mismo motivo. */
  netMarginPct: number | null;
  warning: ReceiptWarning;
  /**
   * Lo que estimamos que ML se llevó contra lo que ML efectivamente facturó.
   * Null mientras la factura de ese período no esté sincronizada.
   */
  reconciliation: { estimated: number; real: number; difference: number } | null;
}

/**
 * Arma el recibo de una orden.
 *
 * El orden de las líneas es el de la cuenta que haría el vendedor a mano:
 * primero lo que se lleva Mercado Libre (comisión y envío, que son los dos
 * que sorprenden), después la publicidad, después lo que costó el producto y
 * al final los impuestos. Cambiarlo hace que el recibo deje de leerse como
 * una resta.
 */
export function buildOrderReceipt(input: OrderReceiptInput): OrderReceipt {
  const share = (amount: number) => (input.revenue > 0 ? amount / input.revenue : 0);

  const costLines: ReceiptLine[] = [
    { label: "Comisión de Mercado Libre", amount: input.mlCommission, kind: "costo" as const },
    { label: "Costo de envío", amount: input.shippingCost, kind: "costo" as const },
    { label: "Publicidad", amount: input.adsCost, kind: "costo" as const },
    { label: "Costo del producto", amount: input.productCost, kind: "costo" as const },
    { label: "IVA", amount: input.iva, kind: "costo" as const },
    { label: "Otros impuestos", amount: input.otherTax, kind: "costo" as const },
  ]
    // Una línea en cero es ruido: no aporta y alarga el recibo. La excepción
    // es el costo del producto cuando falta cargarlo — ahí el cero es
    // justamente lo que hay que ver, y por eso se avisa aparte.
    .filter((line) => line.amount !== 0)
    .map((line) => ({ ...line, share: share(line.amount) }));

  const lines: ReceiptLine[] = [
    { label: "Precio de venta", amount: input.revenue, kind: "ingreso", share: 1 },
    ...costLines,
  ];

  const totalCosts =
    input.mlCommission + input.shippingCost + input.adsCost + input.productCost + input.iva + input.otherTax;

  const netMargin = input.costMissing ? null : input.revenue - totalCosts;
  const netMarginPct = netMargin !== null && input.revenue > 0 ? netMargin / input.revenue : null;

  let warning: ReceiptWarning = null;
  if (input.costMissing) warning = "sin_costo";
  else if (netMargin !== null && netMargin < 0) warning = "margen_negativo";

  // Lo que ML se llevó de verdad contra lo que estimamos. Solo comisión y
  // envío: son los dos conceptos que la factura ata a una orden puntual.
  const estimated = input.mlCommission + input.shippingCost;
  const reconciliation =
    input.realMlCharges === null || input.realMlCharges === undefined
      ? null
      : { estimated, real: input.realMlCharges, difference: input.realMlCharges - estimated };

  return {
    orderId: input.orderId,
    date: input.date,
    revenue: input.revenue,
    lines,
    netMargin,
    netMarginPct,
    warning,
    reconciliation,
  };
}

export const RECEIPT_WARNING_LABEL: Record<Exclude<ReceiptWarning, null>, string> = {
  margen_negativo: "Margen negativo: esta venta te costó plata",
  sin_costo: "Falta cargar el costo del producto",
};
