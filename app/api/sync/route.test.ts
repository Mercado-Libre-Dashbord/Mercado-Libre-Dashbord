import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/sync/sync-service", () => ({ runSync: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { POST } from "./route";
import { withScope } from "@/db/client";
import { runSync } from "@/sync/sync-service";
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

    expect(await res.json()).toEqual({ productsSynced: 1, ordersSynced: 2, adsRowsSynced: 0, billingChargesSynced: 0 });
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

  it("reprocesses the whole history when full is requested", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1" } as any);
    const query = vi.fn().mockResolvedValue({ rows: [{ latest: "2026-08-10T00:00:00Z" }] });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    vi.mocked(runSync).mockResolvedValue({ productsSynced: 0, ordersSynced: 0, adsRowsSynced: 0, billingChargesSynced: 0 });

    await POST(req({ full: true }));

    // Ignora la última orden guardada y arranca del principio, para poder
    // rellenar datos que antes se guardaron mal (ej. el envío en $0).
    expect(vi.mocked(runSync).mock.calls[0][3]).toBe("2020-01-01T00:00:00Z");
    expect(query).not.toHaveBeenCalled();
  });
});
