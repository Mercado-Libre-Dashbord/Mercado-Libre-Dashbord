import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

import { POST, GET } from "./route";
import { getDb } from "@/db/client";

describe("POST /api/ads-spend", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("inserts a manual ad spend row with product_id NULL", async () => {
    const run = vi.fn();
    vi.mocked(getDb).mockReturnValue({ prepare: () => ({ run }) } as any);
    const request = { json: async () => ({ channel: "google", date: "2026-01-10", amount: 500 }) } as any;

    const res = await POST(request);

    expect(await res.json()).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith("2026-01-10", 500, "google");
  });
});

describe("GET /api/ads-spend", () => {
  it("returns manual entries excluding mercado_ads rows", async () => {
    const all = vi.fn().mockReturnValue([{ id: 1, date: "2026-01-10", amount: 500, channel: "google" }]);
    vi.mocked(getDb).mockReturnValue({ prepare: () => ({ all }) } as any);

    const request = { nextUrl: { searchParams: new URLSearchParams() } } as any;
    const res = await GET(request);

    expect(await res.json()).toEqual([{ id: 1, date: "2026-01-10", amount: 500, channel: "google" }]);
  });
});
