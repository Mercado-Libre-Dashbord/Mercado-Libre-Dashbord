export interface ProductCostEntry {
  cost: number;
  validFrom: string;
}

export function getCostAtDate(costs: ProductCostEntry[], date: string): number | null {
  let best: ProductCostEntry | null = null;
  for (const c of costs) {
    if (c.validFrom <= date && (best === null || c.validFrom >= best.validFrom)) {
      best = c;
    }
  }
  return best ? best.cost : null;
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
