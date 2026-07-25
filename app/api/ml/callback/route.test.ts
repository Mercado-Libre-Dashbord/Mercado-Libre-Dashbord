import { describe, it, expect, vi } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/db/tokens", () => ({ saveTokens: vi.fn() }));
vi.mock("@/db/accounts", () => ({ setAccountMlSellerId: vi.fn() }));

import { GET } from "./route";

describe("GET /api/ml/callback", () => {
  it("returns 400 when the authorization code is missing", async () => {
    const request = { nextUrl: { searchParams: new URLSearchParams({ state: "acc1" }) } } as any;
    const res = await GET(request);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing authorization code" });
  });

  it("returns 400 when the state (account id) is missing", async () => {
    const request = { nextUrl: { searchParams: new URLSearchParams({ code: "abc" }) } } as any;
    const res = await GET(request);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing state (account id)" });
  });
});
