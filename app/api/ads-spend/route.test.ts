import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { POST, GET } from "./route";
import { withScope } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";

const account = { id: "acc1", name: "Cuenta", ownerEmail: "a@example.com", mlSellerId: "S1", otherTaxRate: 0, createdAt: "2026-01-01" };

describe("POST /api/ads-spend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
  });

  it("rejects an unknown channel", async () => {
    const request = { json: async () => ({ channel: "mercado_ads", date: "2026-01-10", amount: 100 }) } as any;
    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("rejects a malformed date", async () => {
    const request = { json: async () => ({ channel: "meta", date: "10-01-2026", amount: 100 }) } as any;
    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("rejects a negative amount", async () => {
    const request = { json: async () => ({ channel: "meta", date: "2026-01-10", amount: -1 }) } as any;
    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("inserts a manual ad spend row scoped to the current account with product_id NULL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    const request = { json: async () => ({ channel: "google", date: "2026-01-10", amount: 500 }) } as any;

    const res = await POST(request);

    expect(await res.json()).toEqual({ ok: true });
    expect(query).toHaveBeenCalledWith(expect.any(String), ["acc1", "2026-01-10", 500, "google"]);
  });
});

describe("GET /api/ads-spend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
  });

  it("returns manual entries excluding mercado_ads rows", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 1, date: "2026-01-10", amount: 500, channel: "google" }] });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));

    const request = { nextUrl: { searchParams: new URLSearchParams() } } as any;
    const res = await GET(request);

    expect(await res.json()).toEqual([{ id: 1, date: "2026-01-10", amount: 500, channel: "google" }]);
  });
});
