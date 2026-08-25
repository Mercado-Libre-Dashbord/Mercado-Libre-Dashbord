import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { GET } from "./route";
import { withScope } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";

const account = { id: "acc1", name: "Cuenta", ownerEmail: "a@example.com", mlSellerId: "S1", createdAt: "2026-01-01" };

describe("GET /api/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
  });

  it("returns 401 when there is no active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);
    const request = { nextUrl: { searchParams: new URLSearchParams() } } as any;
    const res = await GET(request);
    expect(res.status).toBe(401);
  });

  it("computes derived KPIs from the raw totals and manual ad spend", async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("ads_spend")) {
        return { rows: [{ total: 200 }] };
      }
      return {
        rows: [
          {
            orders: 2,
            grossSales: 2000,
            totalCommission: 260,
            totalShipping: 180,
            totalMercadoAds: 100,
            totalCost: 600,
            netProfit: 860,
            itemsMissingCost: 0,
            ordersWithCost: 2,
          },
        ],
      };
    });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));

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
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("ads_spend")) return { rows: [{ total: 0 }] };
      return {
        rows: [
          {
            orders: 0,
            grossSales: 0,
            totalCommission: 0,
            totalShipping: 0,
            totalMercadoAds: 0,
            totalCost: 0,
            netProfit: 0,
            itemsMissingCost: 0,
            ordersWithCost: 0,
          },
        ],
      };
    });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));

    const request = { nextUrl: { searchParams: new URLSearchParams() } } as any;
    const body = await (await GET(request)).json();

    expect(body.aov).toBe(0);
    expect(body.mer).toBe(0);
    expect(body.cpa).toBe(0);
  });

  it("returns the daily breakdown when groupBy=day", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { day: "2026-01-05", revenue: 1000, commission: 130, shipping: 90, cost: 300, tax: 20, netProfit: 460 },
      ],
    });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));

    const request = { nextUrl: { searchParams: new URLSearchParams("groupBy=day") } } as any;
    const body = await (await GET(request)).json();

    expect(body).toEqual([
      { day: "2026-01-05", revenue: 1000, commission: 130, shipping: 90, cost: 300, tax: 20, netProfit: 460 },
    ]);
  });
});
