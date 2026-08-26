import { IVA_RATE, ivaFromGross, netFromGross } from "./iva";

/**
 * Reglas de facturación electrónica (ARCA, ex AFIP) para vendedores argentinos.
 *
 * Este archivo es solo la parte fiscal: qué comprobante corresponde y por qué
 * importes. No habla con ARCA — eso vive detrás de InvoiceProvider, para poder
 * probar toda esta lógica sin certificados ni red, que es donde están los
 * errores caros (emitir un comprobante equivocado no se deshace: se corrige
 * con una nota de crédito).
 */

/** Condición del comprador frente al IVA (códigos de ARCA, RG 5616). */
export const BUYER_IVA_CONDITION = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
} as const;

export type BuyerIvaCondition = (typeof BUYER_IVA_CONDITION)[keyof typeof BUYER_IVA_CONDITION];

/** Tipo de comprobante (códigos de ARCA). */
export const INVOICE_TYPE = {
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
  NOTA_CREDITO_A: 3,
  NOTA_CREDITO_B: 8,
  NOTA_CREDITO_C: 13,
} as const;

export type InvoiceType = (typeof INVOICE_TYPE)[keyof typeof INVOICE_TYPE];

/** Tipo de documento del comprador (códigos de ARCA). */
export const DOC_TYPE = { CUIT: 80, DNI: 96, SIN_IDENTIFICAR: 99 } as const;

export type SellerCondition = "responsable_inscripto" | "monotributo";

export interface BuyerInfo {
  ivaCondition: BuyerIvaCondition;
  /** CUIT o DNI sin guiones. Null si la venta es a consumidor final anónimo. */
  docNumber: string | null;
}

/**
 * Qué comprobante corresponde emitir.
 *
 * - Monotributista: siempre C, sin importar a quién le venda.
 * - Responsable Inscripto: A cuando el comprador también discrimina IVA
 *   (RI o exento), B en cualquier otro caso.
 *
 * Una A a consumidor final es rechazada por ARCA, y una B a un RI le impide
 * al comprador tomarse el crédito fiscal — por eso esto no es una preferencia
 * del vendedor sino una regla.
 */
export function resolveInvoiceType(seller: SellerCondition, buyer: BuyerInfo): InvoiceType {
  if (seller === "monotributo") return INVOICE_TYPE.FACTURA_C;

  const discriminaIva =
    buyer.ivaCondition === BUYER_IVA_CONDITION.RESPONSABLE_INSCRIPTO ||
    buyer.ivaCondition === BUYER_IVA_CONDITION.EXENTO;

  // Sin CUIT no se puede emitir una A aunque el comprador diga ser RI.
  return discriminaIva && buyer.docNumber ? INVOICE_TYPE.FACTURA_A : INVOICE_TYPE.FACTURA_B;
}

export function resolveDocType(buyer: BuyerInfo): number {
  if (!buyer.docNumber) return DOC_TYPE.SIN_IDENTIFICAR;
  // El CUIT tiene 11 dígitos; el DNI, 7 u 8.
  return buyer.docNumber.replace(/\D/g, "").length === 11 ? DOC_TYPE.CUIT : DOC_TYPE.DNI;
}

export interface InvoiceAmounts {
  /** Lo que efectivamente pagó el comprador: siempre con IVA incluido. */
  total: number;
  /** Base imponible, sin IVA. */
  net: number;
  /** IVA del comprobante. */
  iva: number;
  /** Alícuota aplicada, como fracción (0.21). */
  ivaRate: number;
}

/**
 * Descompone el precio de venta en neto + IVA.
 *
 * El precio publicado en Mercado Libre (y en cualquier tienda al consumidor)
 * ya incluye IVA, así que siempre se parte del total y se va hacia atrás: si
 * se calculara al revés, el total facturado no coincidiría con lo que el
 * comprador pagó, que es justamente lo que ARCA cruza.
 *
 * En la Factura C el IVA no se discrimina —el monotributista no lo liquida—
 * así que el neto es el total y el IVA va en cero.
 */
export function calculateInvoiceAmounts(grossTotal: number, invoiceType: InvoiceType): InvoiceAmounts {
  if (invoiceType === INVOICE_TYPE.FACTURA_C || invoiceType === INVOICE_TYPE.NOTA_CREDITO_C) {
    return { total: grossTotal, net: grossTotal, iva: 0, ivaRate: 0 };
  }
  return {
    total: grossTotal,
    net: netFromGross(grossTotal),
    iva: ivaFromGross(grossTotal),
    ivaRate: IVA_RATE,
  };
}

export interface InvoiceDraft {
  orderId: string;
  invoiceType: InvoiceType;
  docType: number;
  docNumber: string;
  buyerIvaCondition: BuyerIvaCondition;
  amounts: InvoiceAmounts;
  /** Fecha del comprobante, YYYY-MM-DD. */
  date: string;
}

export interface PrepareInvoiceInput {
  orderId: string;
  /** Total cobrado al comprador, con IVA. */
  grossTotal: number;
  /** Fecha de la venta en ISO. */
  soldAt: string;
  seller: SellerCondition;
  buyer: BuyerInfo;
}

/**
 * Arma el borrador del comprobante a partir de una venta. No lo emite: eso lo
 * hace el proveedor, y recién ahí el comprobante existe para ARCA.
 */
export function prepareInvoice(input: PrepareInvoiceInput): InvoiceDraft {
  const invoiceType = resolveInvoiceType(input.seller, input.buyer);
  return {
    orderId: input.orderId,
    invoiceType,
    docType: resolveDocType(input.buyer),
    // ARCA espera 0 cuando no hay documento (consumidor final anónimo).
    docNumber: input.buyer.docNumber?.replace(/\D/g, "") || "0",
    buyerIvaCondition: input.buyer.ivaCondition,
    amounts: calculateInvoiceAmounts(input.grossTotal, invoiceType),
    date: input.soldAt.slice(0, 10),
  };
}

export interface IssuedInvoice {
  cae: string;
  /** Vencimiento del CAE, YYYY-MM-DD. */
  caeExpiresAt: string;
  pointOfSale: number;
  number: number;
}

/**
 * Lo que tiene que implementar quien hable con ARCA.
 *
 * Se deja como interfaz a propósito: se puede resolver contra los web services
 * de ARCA (WSAA + WSFEv1, que exige manejar el certificado del cliente) o
 * contra un gateway que ya lo haga. La decisión no cambia nada de la lógica
 * fiscal de arriba ni de lo que se guarda en la base.
 */
export interface InvoiceProvider {
  readonly name: string;
  issue(draft: InvoiceDraft): Promise<IssuedInvoice>;
}
