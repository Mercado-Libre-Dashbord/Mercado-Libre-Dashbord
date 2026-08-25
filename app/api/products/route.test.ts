import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn((ctx: unknown, fn: (client: unknown) => unknown) => fn({ query: vi.fn() })) }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { PATCH } from "./route";
import { withScope } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";
import { resetColumnCache } from "@/db/schema-capabilities";

const account = { id: "acc1", name: "Cuenta", ownerEmail: "a@example.com", mlSellerId: "S1", otherTaxRate: 0, createdAt: "2026-01-01" };

function queryMock() {
  return vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.columns")) {
      return { rows: [{ table_name: "products", column_name: "thumbnail" }] };
    }
    return { rows: [] };
  });
}

describe("PATCH /api/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetColumnCache();
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
    const query = queryMock();
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    const request = { json: async () => ({ productId: "MLA1", cost: 350 }) } as any;

    const res = await PATCH(request);

    expect(await res.json()).toEqual({ ok: true });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO product_costs"), [
      "acc1",
      "MLA1",
      350,
      expect.any(String),
    ]);
  });

  it("ignores a per-product tax: taxes are an account-level rate now", async () => {
    const query = queryMock();
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    const request = { json: async () => ({ productId: "MLA1", cost: 350, tax: 40 }) } as any;

    await PATCH(request);

    const insert = query.mock.calls.find((c) => String(c[0]).includes("INSERT INTO product_costs"));
    expect(insert?.[0]).not.toContain("tax");
    expect(insert?.[1]).toEqual(["acc1", "MLA1", 350, expect.any(String)]);
  });
});
