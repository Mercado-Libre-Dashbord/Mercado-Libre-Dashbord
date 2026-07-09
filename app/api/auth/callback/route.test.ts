import { describe, it, expect, vi } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/db/tokens", () => ({ saveTokens: vi.fn() }));

import { GET } from "./route";

describe("GET /api/auth/callback", () => {
  it("returns 400 when the authorization code is missing", async () => {
    const request = { nextUrl: { searchParams: new URLSearchParams() } } as any;
    const res = await GET(request);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing authorization code" });
  });
});
