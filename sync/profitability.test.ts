import { describe, it, expect } from "vitest";
import { getCostAtDate, allocateAdsCost, calculateNetProfit } from "./profitability";

describe("getCostAtDate", () => {
  it("returns null when no cost entries exist", () => {
    expect(getCostAtDate([], "2026-01-01")).toBeNull();
  });

  it("returns the most recent cost valid on or before the date", () => {
    const costs = [
      { cost: 100, validFrom: "2026-01-01" },
      { cost: 120, validFrom: "2026-03-01" },
    ];
    expect(getCostAtDate(costs, "2026-02-15")).toBe(100);
    expect(getCostAtDate(costs, "2026-03-15")).toBe(120);
  });

  it("falls back to the earliest known cost when it was loaded after the sale date", () => {
    // Cargar el primer costo de un producto no debería dejar sin dato a las
    // ventas históricas anteriores a esa carga — usamos la mejor estimación
    // disponible en vez de null.
    const costs = [{ cost: 100, validFrom: "2026-03-01" }];
    expect(getCostAtDate(costs, "2026-01-01")).toBe(100);
  });

  it("still prefers a cost valid on or before the date over the earliest one", () => {
    const costs = [
      { cost: 100, validFrom: "2026-03-01" },
      { cost: 80, validFrom: "2025-01-01" },
    ];
    expect(getCostAtDate(costs, "2025-06-01")).toBe(80);
  });

  it("picks the latest entry when two share the same validFrom date", () => {
    const costs = [
      { cost: 100, validFrom: "2026-01-01" },
      { cost: 150, validFrom: "2026-01-01" },
    ];
    expect(getCostAtDate(costs, "2026-01-01")).toBe(150);
  });
});

describe("allocateAdsCost", () => {
  it("returns 0 when no units were sold that day", () => {
    expect(allocateAdsCost(500, 0, 1)).toBe(0);
  });

  it("prorates spend proportionally to units in this line", () => {
    expect(allocateAdsCost(500, 5, 2)).toBe(200);
  });

  it("returns the full spend when this line is the only unit sold", () => {
    expect(allocateAdsCost(500, 1, 1)).toBe(500);
  });
});

describe("calculateNetProfit", () => {
  it("returns null when no cost was applied", () => {
    const result = calculateNetProfit({
      unitPrice: 1000,
      quantity: 1,
      mlCommission: 130,
      shippingCost: 90,
      adsCostAllocated: 50,
      costApplied: null,
    });
    expect(result).toBeNull();
  });

  it("computes net profit subtracting all costs", () => {
    const result = calculateNetProfit({
      unitPrice: 1000,
      quantity: 2,
      mlCommission: 130,
      shippingCost: 90,
      adsCostAllocated: 50,
      costApplied: 300,
    });
    expect(result).toBe(1130);
  });
});
