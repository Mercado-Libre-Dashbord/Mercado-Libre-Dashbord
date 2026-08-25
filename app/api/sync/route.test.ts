import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/sync/sync-service", () => ({
  runSync: vi.fn(),
  syncProducts: vi.fn().mockResolvedValue(0),
  syncOrders: vi.fn().mockResolvedValue(0),
  syncAds: vi.fn().mockResolvedValue(0),
  syncBillingCharges: vi.fn().mockResolvedValue(0),
  recalculate: vi.fn(),
}));
vi.mock("@/mcp/tools", () => ({ listOrdersPage: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { POST } from "./route";
import { withScope } from "@/db/client";
import { runSync, syncOrders, syncProducts, recalculate } from "@/sync/sync-service";
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
      createdAt: "2026-01-01T00:00:00Z",
    });

    const res = await POST(req());

    expect(res.status).toBe(400);
  });

  it("returns the sync result as JSON", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({
      id: "acc1",
      name: "Cuenta",
      ownerEmail: "a@example.com",
      mlSellerId: "SELLER1",
      createdAt: "2026-01-01T00:00:00Z",
    });
    const query = vi.fn().mockResolvedValue({ rows: [{ latest: "2026-01-01T00:00:00Z" }] });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    vi.mocked(runSync).mockResolvedValue({ productsSynced: 1, ordersSynced: 2, adsRowsSynced: 0, billingChargesSynced: 0 });

    const res = await POST(req());

    // `done` acompaña a la respuesta también en el sync incremental, para que
    // el cliente use la misma forma en los dos modos.
    expect(await res.json()).toEqual({ productsSynced: 1, ordersSynced: 2, adsRowsSynced: 0, billingChargesSynced: 0, done: true });
  });

  it("returns a 500 with the error message when sync fails", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({
      id: "acc1",
      name: "Cuenta",
      ownerEmail: "a@example.com",
      mlSellerId: "SELLER1",
      createdAt: "2026-01-01T00:00:00Z",
    });
    const query = vi.fn().mockResolvedValue({ rows: [{ latest: null }] });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    vi.mocked(runSync).mockRejectedValue(new Error("boom"));

    const res = await POST(req());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });

  it("only fetches orders newer than the latest stored one by default", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1" } as any);
    const query = vi.fn().mockResolvedValue({ rows: [{ latest: "2026-08-10T00:00:00Z" }] });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    vi.mocked(runSync).mockResolvedValue({ productsSynced: 0, ordersSynced: 0, adsRowsSynced: 0, billingChargesSynced: 0 });

    await POST(req());

    expect(vi.mocked(runSync).mock.calls[0][3]).toBe("2026-08-10T00:00:00.000Z");
  });

  it("processes the history in batches instead of one long request", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1" } as any);
    const query = vi.fn().mockResolvedValue({ rows: [{}] });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: ["1", "2"], total: 25 });
    vi.mocked(syncOrders).mockResolvedValue(2);

    const body = await (await POST(req({ full: true, offset: 10 }))).json();

    // Sigue desde donde quedó y todavía no terminó: el cliente vuelve a llamar.
    expect(vi.mocked(listOrdersPage).mock.calls[0][3]).toBe(10);
    expect(body.done).toBe(false);
    expect(body.offset).toBe(12);
    expect(body.totalOrders).toBe(25);
    // El catálogo solo se sincroniza en el primer lote.
    expect(vi.mocked(syncProducts)).not.toHaveBeenCalled();
    // Y el recálculo espera a tener todas las órdenes.
    expect(vi.mocked(recalculate)).not.toHaveBeenCalled();
  });

  it("reads the whole history from the start, not from the newest stored order", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1" } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [{}] }) }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: [], total: 0 });

    await POST(req({ full: true }));

    expect(vi.mocked(listOrdersPage).mock.calls[0][2]).toBe("2020-01-01T00:00:00Z");
  });

  it("finishes the run — ads, recalc and billing — only on the last batch", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1" } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [{}] }) }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: ["1"], total: 6 });
    vi.mocked(syncOrders).mockResolvedValue(1);

    const body = await (await POST(req({ full: true, offset: 5 }))).json();

    expect(body.done).toBe(true);
    expect(vi.mocked(recalculate)).toHaveBeenCalled();
  });
});
