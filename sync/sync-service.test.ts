import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";

vi.mock("@/mcp/tools", () => ({
  listProducts: vi.fn(),
  listOrders: vi.fn(),
  getOrderDetail: vi.fn(),
  getAdsSpend: vi.fn(),
  getProductsByIds: vi.fn().mockResolvedValue([]),
  getOrderItemTitles: vi.fn().mockResolvedValue(new Map()),
}));

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://app_user:app_user_local_test_pw@localhost:5432/ml_dashboard_test";

/** Cuenta nueva y aislada por test. La usan los dos describes de este archivo. */
async function makeAccount() {
  const { withScope } = await import("@/db/client");
  const { createAccount } = await import("@/db/accounts");
  return withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta test", `sync.${nanoid(8)}@example.com`));
}

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
});

afterAll(async () => {
  const { closeDb } = await import("@/db/client");
  await closeDb();
});

describe("runSync", () => {
  it("persists products, orders and a computed net_profit per order item", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValueOnce([
      { id: "MLA1", title: "Producto 1", sku: "SKU1", price: 1000, stock: 5, permalink: "url", categoryId: "MLA1234", categoryName: "Categoría de prueba", thumbnail: null },
    ]);
    vi.mocked(listOrders).mockResolvedValueOnce(["ORD1"]);
    vi.mocked(getOrderDetail).mockResolvedValueOnce({
      id: "ORD1",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 1000,
      items: [{ productId: "MLA1", productTitle: "Producto de prueba", unitPrice: 1000, quantity: 1, mlCommission: 130, shippingCost: 90 }],
    });
    vi.mocked(getAdsSpend).mockResolvedValueOnce([{ productId: "MLA1", date: "2026-01-10", amount: 50 }]);

    const { withScope } = await import("@/db/client");
    const { runSync } = await import("./sync-service");
    const account = await makeAccount();

    const result = await withScope({ accountId: account.id }, async (client) => {
      await client.query(`INSERT INTO product_costs (account_id, product_id, cost, valid_from) VALUES ($1, $2, $3, $4)`, [
        account.id,
        "MLA1",
        300,
        "2026-01-01",
      ]);
      return runSync(client, account.id, "SELLER1", "2026-01-01T00:00:00Z");
    });

    expect(result).toEqual({ productsSynced: 1, ordersSynced: 1, adsRowsSynced: 1, billingChargesSynced: 0 });

    const item = await withScope({ accountId: account.id }, async (client) => {
      const r = await client.query<{ net_profit: number; cost_applied: number }>(
        `SELECT * FROM order_items WHERE account_id = $1 AND order_id = 'ORD1'`,
        [account.id]
      );
      return r.rows[0];
    });
    // 1000 − 130 − 90 − 50 − 300 = 430 antes de impuestos, menos el IVA que
    // esta venta le deja a pagar a ARCA: débito 21/121 de 1000, contra el
    // crédito de la comisión, el envío, la publicidad y el costo. Da 430/1,21,
    // que es la misma cuenta que calcular todo neto de IVA.
    expect(Number(item.net_profit)).toBeCloseTo(430 / 1.21, 6);
    expect(Number(item.cost_applied)).toBe(300);
  });

  it("leaves net_profit null when the product has no cost loaded", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValueOnce([]);
    vi.mocked(listOrders).mockResolvedValueOnce(["ORD2"]);
    vi.mocked(getOrderDetail).mockResolvedValueOnce({
      id: "ORD2",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 500,
      items: [{ productId: "MLA2", productTitle: "Producto de prueba", unitPrice: 500, quantity: 1, mlCommission: 65, shippingCost: 90 }],
    });
    vi.mocked(getAdsSpend).mockResolvedValueOnce([]);

    const { withScope } = await import("@/db/client");
    const { runSync } = await import("./sync-service");
    const account = await makeAccount();
    await withScope({ accountId: account.id }, (client) => runSync(client, account.id, "SELLER1", "2026-01-01T00:00:00Z"));

    const item = await withScope({ accountId: account.id }, async (client) => {
      const r = await client.query<{ net_profit: number | null; cost_applied: number | null }>(
        `SELECT * FROM order_items WHERE account_id = $1 AND order_id = 'ORD2'`,
        [account.id]
      );
      return r.rows[0];
    });
    expect(item.net_profit).toBeNull();
    expect(item.cost_applied).toBeNull();
  });

  it("re-running sync for the same order does not duplicate order_items", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValue([]);
    vi.mocked(listOrders).mockResolvedValue(["ORD3"]);
    vi.mocked(getOrderDetail).mockResolvedValue({
      id: "ORD3",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 500,
      items: [{ productId: "MLA3", productTitle: "Producto de prueba", unitPrice: 500, quantity: 1, mlCommission: 65, shippingCost: 90 }],
    });
    vi.mocked(getAdsSpend).mockResolvedValue([]);

    const { withScope } = await import("@/db/client");
    const { runSync } = await import("./sync-service");
    const account = await makeAccount();
    await withScope({ accountId: account.id }, (client) => runSync(client, account.id, "SELLER1", "2026-01-01T00:00:00Z"));
    await withScope({ accountId: account.id }, (client) => runSync(client, account.id, "SELLER1", "2026-01-01T00:00:00Z"));

    const count = await withScope({ accountId: account.id }, async (client) => {
      const r = await client.query<{ c: string }>(
        `SELECT COUNT(*) as c FROM order_items WHERE account_id = $1 AND order_id = 'ORD3'`,
        [account.id]
      );
      return Number(r.rows[0].c);
    });
    expect(count).toBe(1);
  });

  it("keeps products and orders synced even when getAdsSpend fails", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValueOnce([
      { id: "MLA4", title: "Producto 4", sku: null, price: 100, stock: 1, permalink: "url", categoryId: "MLA1234", categoryName: "Categoría de prueba", thumbnail: null },
    ]);
    vi.mocked(listOrders).mockResolvedValueOnce(["ORD4"]);
    vi.mocked(getOrderDetail).mockResolvedValueOnce({
      id: "ORD4",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 100,
      items: [{ productId: "MLA4", productTitle: "Producto de prueba", unitPrice: 100, quantity: 1, mlCommission: 13, shippingCost: 20 }],
    });
    vi.mocked(getAdsSpend).mockRejectedValueOnce(new Error("Ads API no disponible"));

    const { withScope } = await import("@/db/client");
    const { runSync } = await import("./sync-service");
    const account = await makeAccount();

    const result = await withScope({ accountId: account.id }, (client) =>
      runSync(client, account.id, "SELLER1", "2026-01-01T00:00:00Z")
    );

    expect(result.productsSynced).toBe(1);
    expect(result.ordersSynced).toBe(1);
    expect(result.adsRowsSynced).toBe(0);

    const order = await withScope({ accountId: account.id }, async (client) => {
      const r = await client.query(`SELECT * FROM orders WHERE account_id = $1 AND id = 'ORD4'`, [account.id]);
      return r.rows[0];
    });
    expect(order).toBeTruthy();
  });
});

describe("backfillMissingProducts", () => {
  it("le pone nombre y foto a una publicación que ya no está en el catálogo", async () => {
    const { getProductsByIds } = await import("@/mcp/tools");
    const { withScope } = await import("@/db/client");
    const { backfillMissingProducts } = await import("./sync-service");
    const account = await makeAccount();

    vi.mocked(getProductsByIds).mockResolvedValueOnce([
      {
        id: "MLA999", title: "Luz De Emergencia 30 Led", sku: "SKU1", price: 12000,
        stock: 0, permalink: "https://ml/p", categoryId: null, categoryName: null,
        thumbnail: "https://thumb",
      },
    ]);

    const saved = await withScope({ accountId: account.id }, async (client) => {
      await client.query(
        `INSERT INTO orders (account_id, id, date_created, status, buyer_total) VALUES ($1,'O1',now(),'paid',100)`,
        [account.id]
      );
      await client.query(
        `INSERT INTO order_items (account_id, order_id, product_id, unit_price, quantity, ml_commission, shipping_cost, ads_cost_allocated)
         VALUES ($1,'O1','MLA999',100,1,0,0,0)`,
        [account.id]
      );
      return backfillMissingProducts(client, account.id, "SELLER1");
    });

    expect(saved).toBe(1);
    const row = await withScope({ accountId: account.id }, async (client) => {
      const r = await client.query<{ title: string; thumbnail: string | null }>(
        `SELECT title, thumbnail FROM products WHERE account_id = $1 AND id = 'MLA999'`,
        [account.id]
      );
      return r.rows[0];
    });
    expect(row.title).toBe("Luz De Emergencia 30 Led");
    expect(row.thumbnail).toBe("https://thumb");
  });

  it("si la publicación fue borrada de ML, saca el nombre de la orden", async () => {
    // Es el caso real: /items ya no la conoce, pero la venta guarda el título
    // con el que se vendió. Sin esto queda como "MLA888" para siempre.
    const { getProductsByIds, getOrderItemTitles } = await import("@/mcp/tools");
    const { withScope } = await import("@/db/client");
    const { backfillMissingProducts } = await import("./sync-service");
    const account = await makeAccount();

    vi.mocked(getProductsByIds).mockResolvedValueOnce([]);
    vi.mocked(getOrderItemTitles).mockResolvedValueOnce(new Map([["MLA888", "Espejo Triple Touch"]]));

    await withScope({ accountId: account.id }, async (client) => {
      await client.query(
        `INSERT INTO orders (account_id, id, date_created, status, buyer_total) VALUES ($1,'O2',now(),'paid',100)`,
        [account.id]
      );
      await client.query(
        `INSERT INTO order_items (account_id, order_id, product_id, unit_price, quantity, ml_commission, shipping_cost, ads_cost_allocated)
         VALUES ($1,'O2','MLA888',100,1,0,0,0)`,
        [account.id]
      );
      return backfillMissingProducts(client, account.id, "SELLER1");
    });

    const title = await withScope({ accountId: account.id }, async (client) => {
      const r = await client.query<{ title: string }>(
        `SELECT title FROM products WHERE account_id = $1 AND id = 'MLA888'`,
        [account.id]
      );
      return r.rows[0]?.title;
    });
    expect(title).toBe("Espejo Triple Touch");
  });

  it("repara una ficha vieja que había quedado con el id como nombre", async () => {
    const { getProductsByIds, getOrderItemTitles } = await import("@/mcp/tools");
    const { withScope } = await import("@/db/client");
    const { backfillMissingProducts } = await import("./sync-service");
    const account = await makeAccount();

    vi.mocked(getProductsByIds).mockResolvedValueOnce([]);
    vi.mocked(getOrderItemTitles).mockResolvedValueOnce(new Map([["MLA777", "Nombre recuperado"]]));

    await withScope({ accountId: account.id }, async (client) => {
      await client.query(
        `INSERT INTO products (account_id, id, title, current_price, stock, updated_at) VALUES ($1,'MLA777','MLA777',0,0,now())`,
        [account.id]
      );
      await client.query(
        `INSERT INTO orders (account_id, id, date_created, status, buyer_total) VALUES ($1,'O3',now(),'paid',100)`,
        [account.id]
      );
      await client.query(
        `INSERT INTO order_items (account_id, order_id, product_id, unit_price, quantity, ml_commission, shipping_cost, ads_cost_allocated)
         VALUES ($1,'O3','MLA777',100,1,0,0,0)`,
        [account.id]
      );
      return backfillMissingProducts(client, account.id, "SELLER1");
    });

    const title = await withScope({ accountId: account.id }, async (client) => {
      const r = await client.query<{ title: string }>(
        `SELECT title FROM products WHERE account_id = $1 AND id = 'MLA777'`,
        [account.id]
      );
      return r.rows[0]?.title;
    });
    expect(title).toBe("Nombre recuperado");
  });
});
