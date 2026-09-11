import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { GET } from "./route";
import { withScope } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";
import { resetColumnCache } from "@/db/schema-capabilities";

const account = {
  id: "acc1", name: "Cuenta", ownerEmail: "a@example.com", mlSellerId: "S1", otherTaxRate: 0,
  taxCondition: "responsable_inscripto" as const, taxConditionConfirmed: true, createdAt: "2026-01-01",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    orderId: "200001", date: "2026-09-01", revenue: 10000, mlCommission: 1300, shippingCost: 1500,
    adsCost: 0, productCost: 4000, otherTax: 0, iva: 900, itemsMissingCost: 0,
    ...overrides,
  };
}

function client(rows: any[], { hasColumns = true, charges = [] as any[] } = {}) {
  const seen: string[] = [];
  const query = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.columns")) {
      return {
        rows: hasColumns
          ? [
              { table_name: "order_items", column_name: "tax_applied" },
              { table_name: "order_items", column_name: "iva_applied" },
              { table_name: "billing_charges", column_name: "detail_id" },
            ]
          : [],
      };
    }
    seen.push(sql);
    if (sql.includes("FROM billing_charges")) return { rows: charges };
    return { rows };
  });
  vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
  return { query, seen };
}

const request = (qs = "") => ({ nextUrl: { searchParams: new URLSearchParams(qs) } }) as any;

describe("GET /api/billing/orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetColumnCache();
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
  });

  it("returns 401 without an active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
  });

  it("builds one receipt per order with the real net margin", async () => {
    client([row()]);
    const body = await (await GET(request())).json();
    expect(body.receipts).toHaveLength(1);
    expect(body.receipts[0].netMargin).toBe(2300);
  });

  it("flags the orders that lost money and counts them", async () => {
    client([
      row({ orderId: "1", revenue: 2500, mlCommission: 400, shippingCost: 1500, productCost: 900, iva: 0 }),
      row({ orderId: "2" }),
    ]);
    const body = await (await GET(request())).json();
    expect(body.negativeCount).toBe(1);
    expect(body.negativeAmount).toBe(-300);
  });

  it("can show only the orders that lost money", async () => {
    client([
      row({ orderId: "1", revenue: 2500, mlCommission: 400, shippingCost: 1500, productCost: 900, iva: 0 }),
      row({ orderId: "2" }),
    ]);
    const body = await (await GET(request("filter=negativo"))).json();
    expect(body.receipts.map((r: any) => r.orderId)).toEqual(["1"]);
  });

  it("keeps counting every losing order even while the list is filtered", async () => {
    // Si el contador mirara solo lo filtrado, el aviso desaparecería justo
    // cuando el vendedor filtra por otra cosa.
    client([row({ orderId: "1", revenue: 100, mlCommission: 400, shippingCost: 0, productCost: 0, iva: 0 })]);
    const body = await (await GET(request("filter=todos"))).json();
    expect(body.negativeCount).toBe(1);
  });

  it("compares against what ML billed, as a positive cost", async () => {
    // En la factura los cargos vienen en negativo (es plata que sale); el
    // costo estimado contra el que se comparan es positivo.
    client([row()], {
      charges: [
        { orderId: "200001", concept: "Comisión por venta", detailType: "CVFV", detailSubType: null, amount: -1500 },
        { orderId: "200001", concept: "Costo de envío", detailType: "CXD", detailSubType: null, amount: -1500 },
      ],
    });
    const body = await (await GET(request())).json();
    expect(body.receipts[0].reconciliation).toEqual({ estimated: 2800, real: 3000, difference: 200 });
  });

  it("only reconciles commission and shipping, not every charge on the order", async () => {
    // Sumando todo, una retención impositiva o la publicidad de esa orden
    // aparecían como "diferencia" aunque la comisión y el envío hubieran
    // coincidido exacto — un descuadre inventado en la única columna que
    // existe para detectar descuadres reales.
    client([row()], {
      charges: [
        { orderId: "200001", concept: "Comisión por venta", detailType: "CVFV", detailSubType: null, amount: -1300 },
        { orderId: "200001", concept: "Costo de envío", detailType: "CXD", detailSubType: null, amount: -1500 },
        { orderId: "200001", concept: "Percepción IVA RG 4310", detailType: null, detailSubType: null, amount: -420 },
        { orderId: "200001", concept: "Product Ads", detailType: null, detailSubType: null, amount: -180 },
      ],
    });
    const body = await (await GET(request())).json();
    expect(body.receipts[0].reconciliation).toEqual({ estimated: 2800, real: 2800, difference: 0 });
  });

  it("does not reconcile an order whose invoice has not arrived yet", async () => {
    // Un 0 ahí diría que ML no cobró nada, que es otra cosa que "todavía no
    // se sabe".
    client([row()], { charges: [] });
    const body = await (await GET(request())).json();
    expect(body.receipts[0].reconciliation).toBeNull();
  });

  it("excludes cancelled orders from the receipts", async () => {
    const { seen } = client([row()]);
    await GET(request());
    expect(seen[0]).toContain("o.status NOT IN ('cancelled', 'invalid')");
  });

  it("still builds the receipt when the optional migrations have not run", async () => {
    // Sin las columnas de impuestos ni la tabla de cargos, el recibo sale
    // igual: sin la línea de IVA y sin la conciliación, no en blanco.
    const { seen } = client([row({ iva: 0, otherTax: 0 })], { hasColumns: false });
    const body = await (await GET(request())).json();
    // Las columnas de impuestos se reemplazan por cero en la query en vez de
    // nombrarlas y fallar con "column does not exist".
    expect(seen[0]).toContain("0::double precision");
    // Y sin la tabla de cargos no se consulta la conciliación en absoluto.
    expect(seen.some((sql) => sql.includes("FROM billing_charges"))).toBe(false);
    expect(body.receipts[0].reconciliation).toBeNull();
    expect(body.receipts[0].netMargin).toBe(3200);
  });
});
