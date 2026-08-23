export interface ProductCostEntry {
  cost: number;
  validFrom: string;
}

export function getCostAtDate(costs: ProductCostEntry[], date: string): number | null {
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
  if (best) return best.cost;
  return earliest ? earliest.cost : null;
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
}

export function calculateNetProfit(input: NetProfitInput): number | null {
  if (input.costApplied === null) return null;
  return (
    input.unitPrice * input.quantity -
    input.mlCommission -
    input.shippingCost -
    input.adsCostAllocated -
    input.costApplied * input.quantity
  );
}
