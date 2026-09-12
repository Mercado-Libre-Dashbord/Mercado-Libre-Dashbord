import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/sync/sync-service", () => ({
  syncProductsPage: vi.fn().mockResolvedValue({ productsSynced: 0, nextScrollId: undefined }),
  syncOrders: vi.fn().mockResolvedValue(0),
  syncAds: vi.fn().mockResolvedValue(0),
  syncFullStock: vi.fn().mockResolvedValue(0),
  syncBillingCharges: vi.fn().mockResolvedValue(0),
  recalculate: vi.fn(),
  backfillMissingProducts: vi.fn().mockResolvedValue(0),
  pendingOrderIds: vi.fn(async (_db: unknown, _acc: string, ids: string[]) => ids),
}));
vi.mock("@/mcp/tools", () => ({ listOrdersPage: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));

import { POST } from "./route";
import { withScope } from "@/db/client";
import { syncOrders, syncProductsPage, recalculate, pendingOrderIds, backfillMissingProducts } from "@/sync/sync-service";
import { listOrdersPage } from "@/mcp/tools";
import { resolveCurrentAccount } from "@/lib/current-account";

/** El route lee `full` del body; los tests que no lo pasan mandan uno vacío. */
function req(body: unknown = {}) {
  return { json: async () => body } as any;
}

describe("POST /api/sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("le avisa a syncOrders y a recalculate que esta cuenta es Monotributista", async () => {
    // El bug real que lo motivó: una cuenta Monotributista se estaba
    // sincronizando como si fuera Responsable Inscripto, así que se le
    // restaba un saldo de IVA que no le corresponde pagar.
    vi.mocked(resolveCurrentAccount).mockResolvedValue({
      id: "acc1", mlSellerId: "S1", otherTaxRate: 0, taxCondition: "monotributo",
    } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: [], total: 0 });

    await POST(req({ offset: 0 }));

    expect(vi.mocked(syncOrders).mock.calls[0][5]).toBe(false);
    expect(vi.mocked(recalculate).mock.calls[0][4]).toBe(false);
  });

  it("returns 401 when there is no active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);

    const res = await POST(req());

    expect(res.status).toBe(401);
  });

  it("returns 400 when the account has not connected Mercado Libre", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({
      id: "acc1",
      name: "Cuenta",
      ownerEmail: "a@example.com",
      mlSellerId: null,
      otherTaxRate: 0, taxCondition: "responsable_inscripto" as const, taxConditionConfirmed: true,
      createdAt: "2026-01-01T00:00:00Z",
    });

    const res = await POST(req());

    expect(res.status).toBe(400);
  });

  it("walks the whole history in batches and reports progress", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0, taxCondition: "responsable_inscripto" } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: ["1", "2"], total: 120 });
    vi.mocked(syncOrders).mockResolvedValue(2);

    const body = await (await POST(req({ offset: 50 }))).json();

    expect(vi.mocked(listOrdersPage).mock.calls[0][2]).toBe("2020-01-01T00:00:00Z");
    expect(vi.mocked(listOrdersPage).mock.calls[0][3]).toBe(50);
    expect(body).toMatchObject({ done: false, offset: 52, totalOrders: 120 });
    // El catálogo solo en el primer lote; el recálculo solo en el último.
    expect(vi.mocked(syncProductsPage)).not.toHaveBeenCalled();
    expect(vi.mocked(recalculate)).not.toHaveBeenCalled();
  });

  it("only asks Mercado Libre for the orders that are not up to date", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0, taxCondition: "responsable_inscripto" } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: ["1", "2", "3"], total: 3 });
    // Solo la 3 está desactualizada.
    vi.mocked(pendingOrderIds).mockResolvedValue(["3"]);

    await POST(req());

    expect(vi.mocked(syncOrders).mock.calls[0][2]).toEqual(["3"]);
  });

  it("finishes the run — ads, recalc and billing — on the last batch", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0, taxCondition: "responsable_inscripto" } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: ["1"], total: 6 });
    vi.mocked(pendingOrderIds).mockImplementation(async (_d: any, _a: any, ids: any) => ids);

    const body = await (await POST(req({ offset: 5 }))).json();

    expect(body.done).toBe(true);
    // Le da nombre y foto a las publicaciones dadas de baja antes de recalcular:
    // si no corre, esas ventas siguen mostrándose como un id suelto.
    expect(vi.mocked(backfillMissingProducts)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recalculate)).toHaveBeenCalled();
  });

  it("un catálogo grande corta el escaneo y devuelve el scroll_id, sin tocar órdenes todavía", async () => {
    // El caso real que motivó esto: una cuenta con muchísimas publicaciones
    // no entraba en el tiempo de una función serverless. En vez de fallar, el
    // servidor tiene que cortar el escaneo, avisar que falta seguir, y no
    // arrancar el lote de órdenes hasta que el catálogo esté completo.
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0, taxCondition: "responsable_inscripto" } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(syncProductsPage).mockResolvedValueOnce({ productsSynced: 3000, nextScrollId: "scroll-abc" });

    const body = await (await POST(req({ offset: 0, productsDone: false }))).json();

    expect(body).toMatchObject({ done: false, productsSynced: 3000, productsScrollId: "scroll-abc", productsDone: false });
    expect(vi.mocked(listOrdersPage)).not.toHaveBeenCalled();
    expect(vi.mocked(syncOrders)).not.toHaveBeenCalled();
  });

  it("retoma el escaneo del catálogo con el scroll_id que mandó el cliente", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0, taxCondition: "responsable_inscripto" } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(syncProductsPage).mockResolvedValueOnce({ productsSynced: 500, nextScrollId: undefined });
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: [], total: 0 });

    await POST(req({ offset: 0, productsScrollId: "scroll-abc", productsDone: false }));

    expect(vi.mocked(syncProductsPage).mock.calls[0][3]).toBe("scroll-abc");
  });

  it("cuando el catálogo termina de escanear dentro de la misma pasada, sigue derecho con las órdenes", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0, taxCondition: "responsable_inscripto" } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(syncProductsPage).mockResolvedValueOnce({ productsSynced: 12, nextScrollId: undefined });
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: [], total: 0 });

    const body = await (await POST(req({ offset: 0, productsDone: false }))).json();

    expect(vi.mocked(listOrdersPage)).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ done: true, productsSynced: 12, productsDone: true });
  });

  it("una vez que el catálogo ya terminó (productsDone), no lo vuelve a escanear en lotes de órdenes siguientes", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0, taxCondition: "responsable_inscripto" } as any);
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    vi.mocked(listOrdersPage).mockResolvedValue({ ids: [], total: 0 });

    await POST(req({ offset: 0, productsDone: true }));

    expect(vi.mocked(syncProductsPage)).not.toHaveBeenCalled();
  });

  it("returns a 500 with the error message when the sync fails", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue({ id: "acc1", mlSellerId: "S1", otherTaxRate: 0, taxCondition: "responsable_inscripto" } as any);
    vi.mocked(withScope).mockRejectedValue(new Error("boom"));

    const res = await POST(req());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
