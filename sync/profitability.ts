export interface ProductCostEntry {
  cost: number;
  validFrom: string;
}

export function getCostAtDate(costs: ProductCostEntry[], date: string): number | null {
  const applicable = costs
    .filter((c) => c.validFrom <= date)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return applicable.length > 0 ? applicable[0].cost : null;
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
