import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));
vi.mock("@/mcp/tools", () => ({ listBillingPeriods: vi.fn(), probeAccountRestrictions: vi.fn() }));

import { GET } from "./route";
import { resolveCurrentAccount } from "@/lib/current-account";
import { listBillingPeriods, probeAccountRestrictions } from "@/mcp/tools";

const account = {
  id: "acc1", name: "Cuenta", ownerEmail: "a@example.com", mlSellerId: "S1", otherTaxRate: 0,
  taxCondition: "responsable_inscripto" as const, taxConditionConfirmed: true, createdAt: "2026-01-01",
};

describe("GET /api/billing/status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when there is no active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("returns 400 when Mercado Libre isn't connected", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ ...account, mlSellerId: null });
    expect((await GET()).status).toBe(400);
  });

  it("marca las restricciones como confirmadas cuando la sonda devuelve un array (aunque esté vacío)", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
    vi.mocked(listBillingPeriods).mockResolvedValue([
      { key: "2026-08-01", dateFrom: "2026-08-01", dateTo: "2026-08-31", amount: 1000, periodStatus: "CLOSED", dueDate: null, paid: null },
    ]);
    vi.mocked(probeAccountRestrictions).mockResolvedValue({ ok: true, isArray: true, length: 0, sampleKeys: [] });

    const body = await (await GET()).json();

    expect(body.periods).toEqual([
      { key: "2026-08-01", dateFrom: "2026-08-01", dateTo: "2026-08-31", amount: 1000, periodStatus: "CLOSED", dueDate: null, paid: null },
    ]);
    expect(body.restrictions).toMatchObject({ confirmed: true, activeRestrictions: 0 });
  });

  it("no confirma nada si la sonda no devuelve un array reconocible", async () => {
    // Es el caso "no sabemos leer esto todavía": mejor decirlo que asumir
    // que la cuenta está limpia de restricciones.
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
    vi.mocked(listBillingPeriods).mockResolvedValue([]);
    vi.mocked(probeAccountRestrictions).mockResolvedValue({ ok: false, error: "404" });

    const body = await (await GET()).json();

    expect(body.restrictions.confirmed).toBe(false);
    expect(body.restrictions.activeRestrictions).toBeNull();
  });

  it("no rompe la respuesta si listBillingPeriods falla", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
    vi.mocked(listBillingPeriods).mockRejectedValue(new Error("boom"));
    vi.mocked(probeAccountRestrictions).mockResolvedValue({ ok: false, error: "boom" });

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).periods).toEqual([]);
  });
});
