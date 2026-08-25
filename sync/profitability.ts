export interface ProductCostEntry {
  cost: number;
  tax: number;
  validFrom: string;
}

export interface CostEntryResult {
  cost: number;
  tax: number;
}

export function getCostEntryAtDate(costs: ProductCostEntry[], date: string): CostEntryResult | null {
  let best: ProductCostEntry | null = null;
  let earliest: ProductCostEntry | null = null;
  for (const c of costs) {
    if (c.validFrom <= date && (best === null || c.validFrom >= best.validFrom)) {
      best = c;
    }
    if (earliest === null || c.validFrom < earliest.validFrom) {
      earliest = c;
    }
  }
  // Un costo cargado hoy para un producto con ventas viejas no tiene ningún
  // registro con validFrom <= date — pero la mejor estimación disponible para
  // esas ventas sigue siendo el primer costo que se cargó, no "sin dato".
  const chosen = best ?? earliest;
  return chosen ? { cost: chosen.cost, tax: chosen.tax } : null;
}

export function allocateAdsCost(
  dailySpend: number,
  unitsSoldThatDay: number,
  unitsInThisLine: number
): number {
  if (unitsSoldThatDay <= 0) return 0;
  return (dailySpend / unitsSoldThatDay) * unitsInThisLine;
}

export interface NetProfitInput {
  unitPrice: number;
  quantity: number;
  mlCommission: number;
  shippingCost: number;
  adsCostAllocated: number;
  costApplied: number | null;
  taxApplied: number | null;
}

export function calculateNetProfit(input: NetProfitInput): number | null {
  if (input.costApplied === null) return null;
  return (
    input.unitPrice * input.quantity -
    input.mlCommission -
    input.shippingCost -
    input.adsCostAllocated -
    input.costApplied * input.quantity -
    (input.taxApplied ?? 0) * input.quantity
  );
}
