import { describe, it, expect } from "vitest";
import { classifyCharge } from "./billing";

describe("classifyCharge", () => {
  it("recognises tax perceptions and withholdings", () => {
    expect(classifyCharge("Percepción IVA RG 4310")).toBe("impuesto");
    expect(classifyCharge("Retención IIBB Buenos Aires")).toBe("impuesto");
    expect(classifyCharge(null, "TAX", "Ingresos Brutos")).toBe("impuesto");
  });

  it("recognises shipping charges", () => {
    expect(classifyCharge("Mercado Envios charge")).toBe("envio");
    expect(classifyCharge("Cargo de envío")).toBe("envio");
  });

  it("recognises advertising charges", () => {
    expect(classifyCharge("Advertising campaigns - Product Ads")).toBe("publicidad");
  });

  it("recognises sales commission", () => {
    expect(classifyCharge("Sales charge")).toBe("comision");
    expect(classifyCharge("Comisión por venta")).toBe("comision");
  });

  it("prefers the tax bucket when a charge mentions both a tax and a sale", () => {
    // "Percepción IVA sobre comisión de venta" es un impuesto, no una comisión.
    expect(classifyCharge("Percepción IVA sobre comisión de venta")).toBe("impuesto");
  });

  it("keeps unknown concepts as 'otro' instead of dropping them", () => {
    expect(classifyCharge("Cargo por servicio raro nuevo")).toBe("otro");
    expect(classifyCharge(null, undefined)).toBe("otro");
  });
});
