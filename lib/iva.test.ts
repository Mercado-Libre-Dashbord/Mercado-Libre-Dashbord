import { describe, it, expect } from "vitest";
import { IVA_RATE, ivaFromGross, netFromGross, ivaBalance } from "./iva";

describe("IVA (Responsable Inscripto)", () => {
  it("splits an IVA-inclusive amount into net and tax", () => {
    expect(netFromGross(121)).toBeCloseTo(100);
    expect(ivaFromGross(121)).toBeCloseTo(21);
    expect(netFromGross(121) + ivaFromGross(121)).toBeCloseTo(121);
  });

  it("treats zero as zero", () => {
    expect(ivaFromGross(0)).toBe(0);
    expect(netFromGross(0)).toBe(0);
  });

  it("nets ML's IVA credit against the sale's IVA debit", () => {
    // Vendo a 1210 (200 de IVA... 210), ML me cobró 121 de comisión y el
    // producto me costó 605: el IVA a pagar es sobre el margen, no sobre todo.
    const balance = ivaBalance({ grossRevenue: 1210, mlCharges: 121, productCost: 605 });
    expect(balance).toBeCloseTo(210 - 21 - 105);
  });

  it("is equivalent to computing the whole margin net of IVA", () => {
    const gross = 50_000;
    const charges = 8_000;
    const cost = 20_000;

    const withIvaLine = gross - charges - cost - ivaBalance({ grossRevenue: gross, mlCharges: charges, productCost: cost });
    const allNet = netFromGross(gross) - netFromGross(charges) - netFromGross(cost);

    expect(withIvaLine).toBeCloseTo(allNet);
  });

  it("goes negative when the sale loses money, i.e. AFIP owes credit back", () => {
    const balance = ivaBalance({ grossRevenue: 1000, mlCharges: 200, productCost: 1200 });
    expect(balance).toBeLessThan(0);
  });

  it("uses the general 21% rate", () => {
    expect(IVA_RATE).toBe(0.21);
  });
});
