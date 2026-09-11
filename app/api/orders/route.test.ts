import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { GET } from "./route";
import { withScope } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";
import { resetColumnCache } from "@/db/schema-capabilities";

const account = {
  id: "acc1", name: "C", ownerEmail: "a@b.com", mlSellerId: "S1", otherTaxRate: 0,
  taxCondition: "responsable_inscripto" as const, taxConditionConfirmed: true, createdAt: "2026-01-01",
};
const req = (qs = "") => ({ nextUrl: { searchParams: new URLSearchParams(qs) } }) as any;

describe("GET /api/orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetColumnCache();
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
  });

  it("returns 401 with no active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  it("filtra por orderId cuando se pide el recibo de una orden puntual", async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: [{ table_name: "order_items", column_name: "iva_applied" }, { table_name: "order_items", column_name: "tax_applied" }] };
      }
      return { rows: [{ id: "OI1", orderId: "O1", productId: "MLA1", ivaApplied: 42, taxApplied: 10 }] };
    });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));

    await GET(req("orderId=O1&from=2026-08-05&to=2026-08-05"));

    const [sql, args] = query.mock.calls.find((c: any[]) => String(c[0]).includes("FROM order_items"))!;
    expect(sql).toContain("o.id = $");
    expect(args).toContain("O1");
    // Trae el IVA de cada línea, no solo "otros impuestos" — antes faltaba
    // para poder armar el recibo completo por venta.
    expect(sql).toContain('"ivaApplied"');
  });

  it('sin la migración de iva_applied, manda NULL en vez de romper la consulta', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) return { rows: [] };
      return { rows: [] };
    });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));

    await GET(req());

    const [sql] = query.mock.calls.find((c: any[]) => String(c[0]).includes("FROM order_items"))!;
    expect(sql).toContain('NULL::double precision as "ivaApplied"');
  });

  it("groupBy=order sigue devolviendo el resumen agregado sin pedir orderId", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ orderId: "O1", estadoPago: "paid", totalOrder: 2000, totalNeto: 578 }] });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));

    const rows = await (await GET(req("groupBy=order"))).json();

    expect(rows).toEqual([{ orderId: "O1", estadoPago: "paid", totalOrder: 2000, totalNeto: 578 }]);
  });
});
