import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { POST, GET } from "./route";
import { withScope } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";

const account = { id: "acc1", name: "Cuenta", ownerEmail: "a@example.com", mlSellerId: "S1", otherTaxRate: 0, taxCondition: "responsable_inscripto" as const, taxConditionConfirmed: true, createdAt: "2026-01-01" };

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

describe("GET /api/ads-spend?groupBy=channel", () => {
  function channelClient(rows: any[]) {
    const query = vi.fn().mockResolvedValue({ rows });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    return query;
  }

  const request = {
    nextUrl: { searchParams: new URLSearchParams("groupBy=channel&from=2026-08-01&to=2026-08-31") },
  } as any;

  beforeEach(() => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
  });

  it("breaks the spend down by platform, biggest first, with its share of the total", async () => {
    channelClient([
      { channel: "meta", amount: 2500, attributed: false },
      { channel: "mercado_ads", amount: 7500, attributed: true },
    ]);

    const body = await (await GET(request)).json();

    expect(body.total).toBe(10000);
    expect(body.channels).toEqual([
      { channel: "mercado_ads", label: "Mercado Ads", amount: 7500, attributed: true, share: 0.75 },
      { channel: "meta", label: "Meta", amount: 2500, attributed: false, share: 0.25 },
    ]);
  });

  it("includes Mercado Ads — el canal más grande no puede faltar del desglose", async () => {
    channelClient([{ channel: "mercado_ads", amount: 1000, attributed: true }]);
    const body = await (await GET(request)).json();
    expect(body.channels.map((c: any) => c.channel)).toContain("mercado_ads");
  });

  it("leaves out channels with nothing spent instead of listing them in zero", async () => {
    channelClient([
      { channel: "meta", amount: 1000, attributed: false },
      { channel: "tiktok", amount: 0, attributed: false },
    ]);
    const body = await (await GET(request)).json();
    expect(body.channels).toHaveLength(1);
  });

  it("reports 0% instead of NaN when nothing was spent at all", async () => {
    channelClient([]);
    const body = await (await GET(request)).json();
    expect(body).toEqual({ total: 0, channels: [] });
  });

  it("returns 401 without an active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);
    expect((await GET(request)).status).toBe(401);
  });
});
