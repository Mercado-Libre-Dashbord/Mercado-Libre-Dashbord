import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn((ctx: unknown, fn: (client: unknown) => unknown) => fn({ query: vi.fn() })) }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { PATCH } from "./route";
import { withScope } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";

const account = { id: "acc1", name: "Cuenta", ownerEmail: "a@example.com", mlSellerId: "S1", createdAt: "2026-01-01" };

describe("PATCH /api/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
  });

  it("returns 401 when there is no active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);
    const request = { json: async () => ({ productId: "MLA1", cost: 350 }) } as any;
    const res = await PATCH(request);
    expect(res.status).toBe(401);
  });

  it("returns 400 when cost is missing or negative", async () => {
    const request = { json: async () => ({ productId: "MLA1", cost: -5 }) } as any;
    const res = await PATCH(request);
    expect(res.status).toBe(400);
  });

  it("inserts a new versioned cost row scoped to the current account", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    const request = { json: async () => ({ productId: "MLA1", cost: 350 }) } as any;

    const res = await PATCH(request);

    expect(await res.json()).toEqual({ ok: true });
    expect(query).toHaveBeenCalledWith(expect.any(String), ["acc1", "MLA1", 350, expect.any(String)]);
  });
});
