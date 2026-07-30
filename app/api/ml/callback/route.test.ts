import { describe, it, expect, vi } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/db/tokens", () => ({ saveTokens: vi.fn() }));
vi.mock("@/db/accounts", () => ({ setAccountMlSellerId: vi.fn() }));
vi.mock("@/lib/current-account", () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
  resolveCurrentAccount: vi.fn().mockResolvedValue(null),
}));

import { GET } from "./route";
import { resolveCurrentAccount } from "@/lib/current-account";

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

  it("rejects an unauthenticated caller instead of trusting state as the account id", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValueOnce(null);
    const request = { nextUrl: { searchParams: new URLSearchParams({ code: "abc", state: "victim-account" }) } } as any;
    const res = await GET(request);
    expect(res.status).toBe(401);
  });

  it("rejects when state doesn't match the caller's own resolved account (anti-IDOR)", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValueOnce({
      id: "attacker-own-account",
      name: "Attacker",
      ownerEmail: "attacker@example.com",
      mlSellerId: null,
      createdAt: "2026-01-01T00:00:00Z",
    });
    const request = {
      nextUrl: { searchParams: new URLSearchParams({ code: "abc", state: "victim-account" }) },
    } as any;
    const res = await GET(request);
    expect(res.status).toBe(401);
  });
});
