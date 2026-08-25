import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/sync/sync-service", () => ({
  syncProducts: vi.fn().mockResolvedValue(0),
  syncOrders: vi.fn().mockResolvedValue(0),
  syncAds: vi.fn().mockResolvedValue(0),
  syncBillingCharges: vi.fn().mockResolvedValue(0),
  recalculate: vi.fn(),
  pendingOrderIds: vi.fn(async (_db: unknown, _acc: string, ids: string[]) => ids),
}));
vi.mock("@/mcp/tools", () => ({ listOrdersPage: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { POST } from "./route";
import { withScope } from "@/db/client";
import { syncOrders, syncProducts, recalculate, pendingOrderIds } from "@/sync/sync-service";
import { listOrdersPage } from "@/mcp/tools";
import { resolveCurrentAccount } from "@/lib/current-account";

/** El route lee `full` del body; los tests que no lo pasan mandan uno vacío. */
function req(body: unknown = {}) {
  return { json: async () => body } as any;
}

describe("POST /api/sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when there is no active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);

    const res = await POST(req());

    expect(res.status).toBe(401);
  });

  it("returns 400 when the account has not connected Mercado Libre", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({
      id: "acc1",
      name: "Cuenta",
      ownerEmail: "a@example.com",
      mlSellerId: null,
      otherTaxRate: 0,
      createdAt: "2026-01-01T00:00:00Z",
    });

    const res = await POST(req());

    expect(res.status).toBe(400);
  });

  it("walks the whole history in batches and reports progress", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0 } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: ["1", "2"], total: 120 });
    vi.mocked(syncOrders).mockResolvedValue(2);

    const body = await (await POST(req({ offset: 50 }))).json();

    expect(vi.mocked(listOrdersPage).mock.calls[0][2]).toBe("2020-01-01T00:00:00Z");
    expect(vi.mocked(listOrdersPage).mock.calls[0][3]).toBe(50);
    expect(body).toMatchObject({ done: false, offset: 52, totalOrders: 120 });
    // El catálogo solo en el primer lote; el recálculo solo en el último.
    expect(vi.mocked(syncProducts)).not.toHaveBeenCalled();
    expect(vi.mocked(recalculate)).not.toHaveBeenCalled();
  });

  it("only asks Mercado Libre for the orders that are not up to date", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0 } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: ["1", "2", "3"], total: 3 });
    // Solo la 3 está desactualizada.
    vi.mocked(pendingOrderIds).mockResolvedValue(["3"]);

    await POST(req());

    expect(vi.mocked(syncOrders).mock.calls[0][2]).toEqual(["3"]);
  });

  it("finishes the run — ads, recalc and billing — on the last batch", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0 } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: ["1"], total: 6 });
    vi.mocked(pendingOrderIds).mockImplementation(async (_d: any, _a: any, ids: any) => ids);

    const body = await (await POST(req({ offset: 5 }))).json();

    expect(body.done).toBe(true);
    expect(vi.mocked(recalculate)).toHaveBeenCalled();
  });

  it("returns a 500 with the error message when the sync fails", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0 } as any);
    vi.mocked(withScope).mockRejectedValue(new Error("boom"));

    const res = await POST(req());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
