import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

vi.mock("@/mcp/tools", () => ({
  listProducts: vi.fn(),
  listOrders: vi.fn(),
  getOrderDetail: vi.fn(),
  getAdsSpend: vi.fn(),
}));

const TEST_DB_PATH = "./data/test-sync.db";

describe("runSync", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    vi.resetModules();
    vi.clearAllMocks();
  });
  afterEach(async () => {
    // Close the open node:sqlite handle before unlinking: on Windows (unlike
    // POSIX) you cannot delete a file that still has an open handle.
    try {
      const mod = await import("@/db/client");
      mod.closeDb();
    } catch {
      // Module might not be loaded
    }
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it("persists products, orders and a computed net_profit per order item", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValue([
      { id: "MLA1", title: "Producto 1", sku: "SKU1", price: 1000, stock: 5, permalink: "url" },
    ]);
    vi.mocked(listOrders).mockResolvedValue(["ORD1"]);
    vi.mocked(getOrderDetail).mockResolvedValue({
      id: "ORD1",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 1000,
      items: [{ productId: "MLA1", unitPrice: 1000, quantity: 1, mlCommission: 130, shippingCost: 90 }],
    });
    vi.mocked(getAdsSpend).mockResolvedValue([{ productId: "MLA1", date: "2026-01-10", amount: 50 }]);

    const { getDb } = await import("@/db/client");
    const db = getDb();
    db.prepare(`INSERT INTO product_costs (product_id, cost, valid_from) VALUES (?, ?, ?)`).run("MLA1", 300, "2026-01-01");

    const { runSync } = await import("./sync-service");
    const result = await runSync(db, "SELLER1", "2026-01-01T00:00:00Z");

    expect(result).toEqual({ productsSynced: 1, ordersSynced: 1, adsRowsSynced: 1 });

    const item = db.prepare(`SELECT * FROM order_items WHERE order_id = 'ORD1'`).get() as any;
    expect(item.net_profit).toBe(430); // 1000 - 130 - 90 - 50 - 300
    expect(item.cost_applied).toBe(300);
  });

  it("leaves net_profit null when the product has no cost loaded", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValue([]);
    vi.mocked(listOrders).mockResolvedValue(["ORD2"]);
    vi.mocked(getOrderDetail).mockResolvedValue({
      id: "ORD2",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 500,
      items: [{ productId: "MLA2", unitPrice: 500, quantity: 1, mlCommission: 65, shippingCost: 90 }],
    });
    vi.mocked(getAdsSpend).mockResolvedValue([]);

    const { getDb } = await import("@/db/client");
    const db = getDb();
    const { runSync } = await import("./sync-service");
    await runSync(db, "SELLER1", "2026-01-01T00:00:00Z");

    const item = db.prepare(`SELECT * FROM order_items WHERE order_id = 'ORD2'`).get() as any;
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

    const { getDb } = await import("@/db/client");
    const db = getDb();
    const { runSync } = await import("./sync-service");
    await runSync(db, "SELLER1", "2026-01-01T00:00:00Z");
    await runSync(db, "SELLER1", "2026-01-01T00:00:00Z");

    const count = db.prepare(`SELECT COUNT(*) as c FROM order_items WHERE order_id = 'ORD3'`).get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("keeps products and orders synced even when getAdsSpend fails", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValue([
      { id: "MLA4", title: "Producto 4", sku: null, price: 100, stock: 1, permalink: "url" },
    ]);
    vi.mocked(listOrders).mockResolvedValue(["ORD4"]);
    vi.mocked(getOrderDetail).mockResolvedValue({
      id: "ORD4",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 100,
      items: [{ productId: "MLA4", unitPrice: 100, quantity: 1, mlCommission: 13, shippingCost: 20 }],
    });
    vi.mocked(getAdsSpend).mockRejectedValue(new Error("Ads API no disponible"));

    const { getDb } = await import("@/db/client");
    const db = getDb();
    const { runSync } = await import("./sync-service");

    const result = await runSync(db, "SELLER1", "2026-01-01T00:00:00Z");

    expect(result.productsSynced).toBe(1);
    expect(result.ordersSynced).toBe(1);
    expect(result.adsRowsSynced).toBe(0);
    const order = db.prepare(`SELECT * FROM orders WHERE id = 'ORD4'`).get();
    expect(order).toBeTruthy();
  });
});
