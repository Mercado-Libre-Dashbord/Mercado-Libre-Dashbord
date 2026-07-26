import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";

vi.mock("@/mcp/tools", () => ({
  listProducts: vi.fn(),
  listOrders: vi.fn(),
  getOrderDetail: vi.fn(),
  getAdsSpend: vi.fn(),
}));

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://app_user:app_user_local_test_pw@localhost:5432/ml_dashboard_test";

describe("runSync", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  afterAll(async () => {
    const { closeDb } = await import("@/db/client");
    await closeDb();
  });

  async function makeAccount() {
    const { withScope } = await import("@/db/client");
    const { createAccount } = await import("@/db/accounts");
    return withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta test", `sync.${nanoid(8)}@example.com`));
  }

  it("persists products, orders and a computed net_profit per order item", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValueOnce([
      { id: "MLA1", title: "Producto 1", sku: "SKU1", price: 1000, stock: 5, permalink: "url" },
    ]);
    vi.mocked(listOrders).mockResolvedValueOnce(["ORD1"]);
    vi.mocked(getOrderDetail).mockResolvedValueOnce({
      id: "ORD1",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 1000,
      items: [{ productId: "MLA1", unitPrice: 1000, quantity: 1, mlCommission: 130, shippingCost: 90 }],
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

    expect(result).toEqual({ productsSynced: 1, ordersSynced: 1, adsRowsSynced: 1 });

    const item = await withScope({ accountId: account.id }, async (client) => {
      const r = await client.query<{ net_profit: number; cost_applied: number }>(
        `SELECT * FROM order_items WHERE account_id = $1 AND order_id = 'ORD1'`,
        [account.id]
      );
      return r.rows[0];
    });
    expect(Number(item.net_profit)).toBe(430); // 1000 - 130 - 90 - 50 - 300
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
      items: [{ productId: "MLA2", unitPrice: 500, quantity: 1, mlCommission: 65, shippingCost: 90 }],
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
      items: [{ productId: "MLA3", unitPrice: 500, quantity: 1, mlCommission: 65, shippingCost: 90 }],
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
      { id: "MLA4", title: "Producto 4", sku: null, price: 100, stock: 1, permalink: "url" },
    ]);
    vi.mocked(listOrders).mockResolvedValueOnce(["ORD4"]);
    vi.mocked(getOrderDetail).mockResolvedValueOnce({
      id: "ORD4",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 100,
      items: [{ productId: "MLA4", unitPrice: 100, quantity: 1, mlCommission: 13, shippingCost: 20 }],
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
