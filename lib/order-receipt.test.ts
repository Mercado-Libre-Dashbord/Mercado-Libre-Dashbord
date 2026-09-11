import { describe, it, expect } from "vitest";
import { buildOrderReceipt, type OrderReceiptInput } from "./order-receipt";

function order(overrides: Partial<OrderReceiptInput> = {}): OrderReceiptInput {
  return {
    orderId: "200001",
    date: "2026-09-01",
    revenue: 10000,
    mlCommission: 1300,
    shippingCost: 1500,
    adsCost: 200,
    productCost: 4000,
    otherTax: 300,
    iva: 900,
    costMissing: false,
    ...overrides,
  };
}

describe("buildOrderReceipt", () => {
  it("leaves the real net margin after every discount", () => {
    const receipt = buildOrderReceipt(order());
    // 10000 - 1300 - 1500 - 200 - 4000 - 900 - 300
    expect(receipt.netMargin).toBe(1800);
    expect(receipt.netMarginPct).toBeCloseTo(0.18, 5);
  });

  it("reads as a subtraction: sale first, then what Mercado Libre takes", () => {
    const receipt = buildOrderReceipt(order());
    expect(receipt.lines.map((l) => l.label)).toEqual([
      "Precio de venta",
      "Comisión de Mercado Libre",
      "Costo de envío",
      "Publicidad",
      "Costo del producto",
      "IVA",
      "Otros impuestos",
    ]);
    expect(receipt.lines[0].kind).toBe("ingreso");
    expect(receipt.lines.slice(1).every((l) => l.kind === "costo")).toBe(true);
  });

  it("shows each cost as a share of the sale", () => {
    const receipt = buildOrderReceipt(order());
    const commission = receipt.lines.find((l) => l.label === "Comisión de Mercado Libre");
    expect(commission?.share).toBeCloseTo(0.13, 5);
  });

  it("keeps every amount positive — el signo lo da el tipo de línea", () => {
    const receipt = buildOrderReceipt(order());
    expect(receipt.lines.every((l) => l.amount > 0)).toBe(true);
  });

  it("warns when the shipping and the commission ate the margin", () => {
    // El caso de ticket bajo: $2.500 de venta con envío gratis de $1.500.
    const receipt = buildOrderReceipt(
      order({ revenue: 2500, mlCommission: 400, shippingCost: 1500, adsCost: 0, productCost: 900, otherTax: 0, iva: 0 })
    );
    expect(receipt.netMargin).toBe(-300);
    expect(receipt.warning).toBe("margen_negativo");
  });

  it("does not invent a margin when the product cost is missing", () => {
    // Con costo cero el margen saldría inflado y parecería una venta buenísima.
    const receipt = buildOrderReceipt(order({ productCost: 0, costMissing: true }));
    expect(receipt.netMargin).toBeNull();
    expect(receipt.netMarginPct).toBeNull();
    expect(receipt.warning).toBe("sin_costo");
  });

  it("prefers the missing-cost warning over the negative-margin one", () => {
    // Sin el costo no se sabe si el margen es negativo: decir que lo es sería
    // afirmar algo que no se puede saber todavía.
    const receipt = buildOrderReceipt(order({ revenue: 100, productCost: 0, costMissing: true }));
    expect(receipt.warning).toBe("sin_costo");
  });

  it("drops lines worth nothing instead of padding the receipt with zeros", () => {
    const receipt = buildOrderReceipt(order({ adsCost: 0, otherTax: 0 }));
    expect(receipt.lines.map((l) => l.label)).not.toContain("Publicidad");
    expect(receipt.lines.map((l) => l.label)).not.toContain("Otros impuestos");
  });

  it("compares what we estimated against what ML actually billed", () => {
    const receipt = buildOrderReceipt(order({ realMlCharges: 3000 }));
    // Estimado: 1300 de comisión + 1500 de envío.
    expect(receipt.reconciliation).toEqual({ estimated: 2800, real: 3000, difference: 200 });
  });

  it("does not compare against an invoice that has not been synced yet", () => {
    expect(buildOrderReceipt(order()).reconciliation).toBeNull();
    expect(buildOrderReceipt(order({ realMlCharges: null })).reconciliation).toBeNull();
  });

  it("survives a refunded order with no revenue without dividing by zero", () => {
    const receipt = buildOrderReceipt(order({ revenue: 0 }));
    expect(receipt.netMarginPct).toBeNull();
    expect(receipt.lines.every((l) => Number.isFinite(l.share))).toBe(true);
  });
});
