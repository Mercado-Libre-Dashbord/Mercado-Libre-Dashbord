import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/sync/sync-service", () => ({ runSync: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { POST } from "./route";
import { getDb } from "@/db/client";
import { runSync } from "@/sync/sync-service";
import { resolveCurrentAccount } from "@/lib/current-account";

describe("POST /api/sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when there is no active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);

    const res = await POST();

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

    const res = await POST();

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
    vi.mocked(getDb).mockResolvedValue({
      execute: async () => ({ rows: [{ latest: "2026-01-01T00:00:00Z" }] }),
    } as any);
    vi.mocked(runSync).mockResolvedValue({ productsSynced: 1, ordersSynced: 2, adsRowsSynced: 0 });

    const res = await POST();

    expect(await res.json()).toEqual({ productsSynced: 1, ordersSynced: 2, adsRowsSynced: 0 });
  });

  it("returns a 500 with the error message when sync fails", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({
      id: "acc1",
      name: "Cuenta",
      ownerEmail: "a@example.com",
      mlSellerId: "SELLER1",
      createdAt: "2026-01-01T00:00:00Z",
    });
    vi.mocked(getDb).mockResolvedValue({
      execute: async () => ({ rows: [{ latest: null }] }),
    } as any);
    vi.mocked(runSync).mockRejectedValue(new Error("boom"));

    const res = await POST();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
