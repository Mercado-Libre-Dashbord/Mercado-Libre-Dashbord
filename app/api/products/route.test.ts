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

    expect(await res.json()).toMatchObject({ ok: true });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO product_costs"), [
      "acc1",
      "MLA1",
      350,
      expect.any(String),
    ]);
  });

  it("applies the cost to that product's existing sales right away", async () => {
    // El bug que arregla: cargar un costo insertaba la fila y nada más. El
    // panel seguía contando esas líneas como "sin costo cargado" hasta que
    // alguien corriera un Sincronizar completo, así que parecía que la carga
    // no había tomado.
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: [{ table_name: "order_items", column_name: "iva_applied" }] };
      }
      if (sql.includes("FROM product_costs")) {
        return { rows: [{ cost: 350, tax: 0, validfrom: "2026-01-01T00:00:00Z" }] };
      }
      if (sql.includes("FROM order_items oi JOIN orders o")) {
        return {
          rows: [
            {
              id: 7, productid: "MLA1", quantity: 2, datecreated: "2026-02-01T00:00:00Z",
              unitprice: 1000, mlcommission: 130, shippingcost: 0, adscostallocated: 0,
            },
          ],
        };
      }
      return { rows: [] };
    });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
    const request = { json: async () => ({ productId: "MLA1", cost: 350 }) } as any;

    const res = await PATCH(request);

    expect(await res.json()).toEqual({ ok: true, itemsUpdated: 1 });
    // La venta vieja queda con el costo recién cargado y su ganancia rehecha.
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE order_items SET cost_applied"),
      expect.arrayContaining([350, 7])
    );
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
