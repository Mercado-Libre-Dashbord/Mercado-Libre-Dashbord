import { describe, it, expect, vi } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

import { GET } from "./route";
import { getDb } from "@/db/client";

describe("GET /api/summary", () => {
  it("computes derived KPIs from the raw totals and manual ad spend", async () => {
    vi.mocked(getDb).mockReturnValue({
      prepare: (sql: string) => {
        if (sql.includes("ads_spend")) {
          return { get: () => ({ total: 200 }) };
        }
        return {
          get: () => ({
            orders: 2,
            grossSales: 2000,
            totalCommission: 260,
            totalShipping: 180,
            totalMercadoAds: 100,
            totalCost: 600,
            netProfit: 860,
            itemsMissingCost: 0,
            ordersWithCost: 2,
          }),
        };
      },
    } as any);

    const request = { nextUrl: { searchParams: new URLSearchParams() } } as any;
    const body = await (await GET(request)).json();

    expect(body.orders).toBe(2);
    expect(body.aov).toBe(1000);
    expect(body.adSpend).toBe(300);
    expect(body.mer).toBeCloseTo(2000 / 300);
    expect(body.cpa).toBe(150);
    expect(body.netAov).toBe(430);
    expect(body.trueCpa).toBe(150);
  });

  it("returns zeroed rates instead of dividing by zero when there is no data", async () => {
    vi.mocked(getDb).mockReturnValue({
      prepare: (sql: string) => {
        if (sql.includes("ads_spend")) return { get: () => ({ total: 0 }) };
        return {
          get: () => ({
            orders: 0,
            grossSales: 0,
            totalCommission: 0,
            totalShipping: 0,
            totalMercadoAds: 0,
            totalCost: 0,
            netProfit: 0,
            itemsMissingCost: 0,
            ordersWithCost: 0,
          }),
        };
      },
    } as any);

    const request = { nextUrl: { searchParams: new URLSearchParams() } } as any;
    const body = await (await GET(request)).json();

    expect(body.aov).toBe(0);
    expect(body.mer).toBe(0);
    expect(body.cpa).toBe(0);
  });
});
