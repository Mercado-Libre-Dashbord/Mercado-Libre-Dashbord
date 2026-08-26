import { describe, it, expect } from "vitest";
import {
  BUYER_IVA_CONDITION,
  DOC_TYPE,
  INVOICE_TYPE,
  calculateInvoiceAmounts,
  prepareInvoice,
  resolveDocType,
  resolveInvoiceType,
} from "./invoicing";

const cuit = { ivaCondition: BUYER_IVA_CONDITION.RESPONSABLE_INSCRIPTO, docNumber: "30712345678" };
const consumidorFinal = { ivaCondition: BUYER_IVA_CONDITION.CONSUMIDOR_FINAL, docNumber: null };

describe("resolveInvoiceType", () => {
  it("emits an A when a registered seller sells to someone who discriminates IVA", () => {
    expect(resolveInvoiceType("responsable_inscripto", cuit)).toBe(INVOICE_TYPE.FACTURA_A);
    expect(
      resolveInvoiceType("responsable_inscripto", { ivaCondition: BUYER_IVA_CONDITION.EXENTO, docNumber: "30712345678" })
    ).toBe(INVOICE_TYPE.FACTURA_A);
  });

  it("emits a B to consumers and monotributistas", () => {
    expect(resolveInvoiceType("responsable_inscripto", consumidorFinal)).toBe(INVOICE_TYPE.FACTURA_B);
    expect(
      resolveInvoiceType("responsable_inscripto", { ivaCondition: BUYER_IVA_CONDITION.MONOTRIBUTO, docNumber: "20345678901" })
    ).toBe(INVOICE_TYPE.FACTURA_B);
  });

  it("never emits an A without a document, even if the buyer claims to be registered", () => {
    // ARCA rechaza la A sin CUIT; emitirla igual sería un comprobante caído.
    expect(
      resolveInvoiceType("responsable_inscripto", { ivaCondition: BUYER_IVA_CONDITION.RESPONSABLE_INSCRIPTO, docNumber: null })
    ).toBe(INVOICE_TYPE.FACTURA_B);
  });

  it("always emits a C for a monotributista seller", () => {
    expect(resolveInvoiceType("monotributo", cuit)).toBe(INVOICE_TYPE.FACTURA_C);
    expect(resolveInvoiceType("monotributo", consumidorFinal)).toBe(INVOICE_TYPE.FACTURA_C);
  });
});

describe("resolveDocType", () => {
  it("tells a CUIT from a DNI by its length", () => {
    expect(resolveDocType(cuit)).toBe(DOC_TYPE.CUIT);
    expect(resolveDocType({ ...consumidorFinal, docNumber: "35123456" })).toBe(DOC_TYPE.DNI);
  });

  it("falls back to 'sin identificar' with no document", () => {
    expect(resolveDocType(consumidorFinal)).toBe(DOC_TYPE.SIN_IDENTIFICAR);
  });
});

describe("calculateInvoiceAmounts", () => {
  it("splits an IVA-inclusive price into net and IVA", () => {
    const amounts = calculateInvoiceAmounts(12100, INVOICE_TYPE.FACTURA_A);
    expect(amounts.net).toBeCloseTo(10000);
    expect(amounts.iva).toBeCloseTo(2100);
    // El total tiene que ser exactamente lo que pagó el comprador.
    expect(amounts.net + amounts.iva).toBeCloseTo(amounts.total);
    expect(amounts.total).toBe(12100);
  });

  it("does not discriminate IVA on a C", () => {
    const amounts = calculateInvoiceAmounts(12100, INVOICE_TYPE.FACTURA_C);
    expect(amounts).toEqual({ total: 12100, net: 12100, iva: 0, ivaRate: 0 });
  });
});

describe("prepareInvoice", () => {
  it("builds a complete draft from a sale", () => {
    const draft = prepareInvoice({
      orderId: "2000017851273082",
      grossTotal: 20900,
      soldAt: "2026-08-09T11:33:37.000Z",
      seller: "responsable_inscripto",
      buyer: cuit,
    });

    expect(draft).toMatchObject({
      orderId: "2000017851273082",
      invoiceType: INVOICE_TYPE.FACTURA_A,
      docType: DOC_TYPE.CUIT,
      docNumber: "30712345678",
      date: "2026-08-09",
    });
    expect(draft.amounts.total).toBe(20900);
  });

  it("uses 0 as the document for an anonymous consumer, which is what ARCA expects", () => {
    const draft = prepareInvoice({
      orderId: "1",
      grossTotal: 1000,
      soldAt: "2026-08-09T00:00:00.000Z",
      seller: "responsable_inscripto",
      buyer: consumidorFinal,
    });
    expect(draft.docNumber).toBe("0");
    expect(draft.docType).toBe(DOC_TYPE.SIN_IDENTIFICAR);
  });

  it("strips separators from the document number", () => {
    const draft = prepareInvoice({
      orderId: "1",
      grossTotal: 1000,
      soldAt: "2026-08-09T00:00:00.000Z",
      seller: "responsable_inscripto",
      buyer: { ivaCondition: BUYER_IVA_CONDITION.RESPONSABLE_INSCRIPTO, docNumber: "30-71234567-8" },
    });
    expect(draft.docNumber).toBe("30712345678");
    expect(draft.invoiceType).toBe(INVOICE_TYPE.FACTURA_A);
  });
});
