import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/sync/sync-service", () => ({ runSync: vi.fn() }));

import { POST } from "./route";
import { getDb } from "@/db/client";
import { runSync } from "@/sync/sync-service";

describe("POST /api/sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the sync result as JSON", async () => {
    vi.mocked(getDb).mockReturnValue({ prepare: () => ({ get: () => ({ latest: "2026-01-01T00:00:00Z" }) }) } as any);
    vi.mocked(runSync).mockResolvedValue({ productsSynced: 1, ordersSynced: 2, adsRowsSynced: 0 });

    const res = await POST();

    expect(await res.json()).toEqual({ productsSynced: 1, ordersSynced: 2, adsRowsSynced: 0 });
  });

  it("returns a 500 with the error message when sync fails", async () => {
    vi.mocked(getDb).mockReturnValue({ prepare: () => ({ get: () => ({ latest: null }) }) } as any);
    vi.mocked(runSync).mockRejectedValue(new Error("boom"));

    const res = await POST();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
