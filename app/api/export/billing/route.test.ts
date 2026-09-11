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

function client(rows: any[], { hasTable = true } = {}) {
  const query = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.columns")) {
      return { rows: hasTable ? [{ table_name: "billing_charges", column_name: "detail_id" }] : [] };
    }
    return { rows };
  });
  vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
}

const request = (qs = "from=2026-08-01&to=2026-08-31") =>
  ({ nextUrl: { searchParams: new URLSearchParams(qs) } }) as any;

function charge(overrides: Record<string, unknown> = {}) {
  return {
    detailId: "d1", periodKey: "2026-08-01", detailType: "CVFV", detailSubType: null,
    concept: "Comisión por venta", orderId: "200001", amount: -1300,
    chargedAt: "2026-08-05T10:00:00Z", ...overrides,
  };
}

describe("GET /api/export/billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetColumnCache();
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
  });

  it("returns 401 without an active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
  });

  it("downloads as a CSV named after the period", async () => {
    client([charge()]);
    const res = await GET(request());
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("cargos-mercado-libre-2026-08-01-a-2026-08-31.csv");
  });

  it("names the ML code and its concept next to the order that generated it", async () => {
    client([charge()]);
    const csv = await (await GET(request())).text();
    const [, row] = csv.trim().split("\n");
    expect(row).toContain("CVFV");
    expect(row).toContain("Comisión por venta (variable)");
    expect(row).toContain("200001");
  });

  it("keeps the sign ML sent so the column adds up to the period balance", async () => {
    // Un cargo es plata que sale; una nota de crédito por una devolución es
    // plata que vuelve. Normalizando a positivo, la suma deja de ser el saldo.
    client([charge({ amount: -1300 }), charge({ detailId: "d2", amount: 450, concept: "Nota de crédito" })]);
    const csv = await (await GET(request())).text();
    expect(csv).toContain("-1300");
    expect(csv).toContain(",450");
  });

  it("classifies each charge so the accountant does not have to", async () => {
    client([charge({ detailType: "CVFN", concept: "Cuotas sin interés" })]);
    const csv = await (await GET(request())).text();
    expect(csv).toContain("Costo financiero (cuotas sin interés)");
  });

  it("starts with a BOM so Excel on Windows reads the accents", async () => {
    client([charge()]);
    // Sobre los bytes crudos a propósito: Response.text() se come el BOM al
    // decodificar, así que mirándolo por ahí el test pasaría igual con o sin.
    const bytes = new Uint8Array(await (await GET(request())).arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("returns just the header when the charges table has not been migrated yet", async () => {
    client([], { hasTable: false });
    const csv = await (await GET(request())).text();
    expect(csv.trim().split("\n")).toHaveLength(1);
  });

  it("quotes a concept that carries a comma", async () => {
    client([charge({ detailType: null, concept: "Envío, tramo largo" })]);
    const csv = await (await GET(request())).text();
    expect(csv).toContain('"Envío, tramo largo"');
  });
});
