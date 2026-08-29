import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { nanoid } from "nanoid";

vi.mock("@/mcp/tools", () => ({
  listProducts: vi.fn(),
  listOrders: vi.fn(),
  getOrderDetail: vi.fn(),
  getAdsSpend: vi.fn(),
}));

// This is the test that matters most for the Supabase migration: it proves
// isolation holds at the *database* level, not just because every route
// happens to remember a WHERE account_id = ... clause. It runs the real
// sync-service against real Postgres, then deliberately issues a query with
// NO account filter (the way a future bug in a route might) and asserts
// Postgres itself still only returns the scoped account's rows.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://app_user:app_user_local_test_pw@localhost:5432/ml_dashboard_test";

describe("RLS account isolation (real Postgres, not mocked)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  afterAll(async () => {
    const { closeDb } = await import("./client");
    await closeDb();
  });

  it("a query scoped to account A never returns account B's products, even with no WHERE account_id clause", async () => {
    const { withScope } = await import("./client");
    const { createAccount } = await import("./accounts");

    const accountA = await withScope({ isAdmin: true }, (client) =>
      createAccount(client, "Cuenta A", `a.${nanoid(6)}@example.com`)
    );
    const accountB = await withScope({ isAdmin: true }, (client) =>
      createAccount(client, "Cuenta B", `b.${nanoid(6)}@example.com`)
    );

    // Same ML item id on purpose: proves isolation doesn't depend on ids
    // happening to differ between sellers.
    await withScope({ accountId: accountA.id }, (client) =>
      client.query(
        `INSERT INTO products (account_id, id, title, current_price, stock, updated_at) VALUES ($1, 'MLA1', 'Producto A', 1000, 5, now())`,
        [accountA.id]
      )
    );
    await withScope({ accountId: accountB.id }, (client) =>
      client.query(
        `INSERT INTO products (account_id, id, title, current_price, stock, updated_at) VALUES ($1, 'MLA1', 'Producto B', 2000, 3, now())`,
        [accountB.id]
      )
    );

    const seenByA = await withScope({ accountId: accountA.id }, async (client) => {
      // Deliberately no `WHERE account_id = ...` — this is the bug scenario.
      const result = await client.query<{ title: string }>("SELECT title FROM products WHERE id = 'MLA1'");
      return result.rows.map((r) => r.title);
    });

    expect(seenByA).toEqual(["Producto A"]);
  });

  it("runSync only ever writes/reads rows for the account it was scoped to", async () => {
    const { withScope } = await import("./client");
    const { createAccount } = await import("./accounts");
    const { runSync } = await import("@/sync/sync-service");
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");

    const accountA = await withScope({ isAdmin: true }, (client) =>
      createAccount(client, "Sync A", `syncA.${nanoid(6)}@example.com`)
    );
    const accountB = await withScope({ isAdmin: true }, (client) =>
      createAccount(client, "Sync B", `syncB.${nanoid(6)}@example.com`)
    );

    // Both accounts happen to sell an item with the same ML id and place an
    // order the same day — the scenario most likely to leak data across
    // accounts if a query is ever missing its account_id filter.
    vi.mocked(listProducts).mockResolvedValueOnce([
      { id: "MLA9", title: "Item de A", sku: null, price: 500, stock: 1, permalink: "url", categoryId: "MLA1234", categoryName: "Categoría de prueba", thumbnail: null },
    ]);
    vi.mocked(listOrders).mockResolvedValueOnce(["ORD-A"]);
    vi.mocked(getOrderDetail).mockResolvedValueOnce({
      id: "ORD-A",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 500,
      items: [{ productId: "MLA9", productTitle: "Producto de prueba", unitPrice: 500, quantity: 1, mlCommission: 50, shippingCost: 20 }],
    });
    vi.mocked(getAdsSpend).mockResolvedValueOnce([]);
    await withScope({ accountId: accountA.id }, (client) => runSync(client, accountA.id, "SELLER-A", "2020-01-01T00:00:00Z"));

    vi.mocked(listProducts).mockResolvedValueOnce([
      { id: "MLA9", title: "Item de B", sku: null, price: 900, stock: 1, permalink: "url", categoryId: "MLA1234", categoryName: "Categoría de prueba", thumbnail: null },
    ]);
    vi.mocked(listOrders).mockResolvedValueOnce(["ORD-B"]);
    vi.mocked(getOrderDetail).mockResolvedValueOnce({
      id: "ORD-B",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 900,
      items: [{ productId: "MLA9", productTitle: "Producto de prueba", unitPrice: 900, quantity: 1, mlCommission: 90, shippingCost: 30 }],
    });
    vi.mocked(getAdsSpend).mockResolvedValueOnce([]);
    await withScope({ accountId: accountB.id }, (client) => runSync(client, accountB.id, "SELLER-B", "2020-01-01T00:00:00Z"));

    // Scoped to A: must see only A's product/order, never B's, even though
    // both share the ML item id "MLA9" and the same order-item table.
    const aView = await withScope({ accountId: accountA.id }, async (client) => {
      const products = await client.query<{ title: string }>("SELECT title FROM products WHERE id = 'MLA9'");
      const items = await client.query<{ unit_price: number }>("SELECT unit_price FROM order_items WHERE product_id = 'MLA9'");
      return { products: products.rows, items: items.rows };
    });

    expect(aView.products).toEqual([{ title: "Item de A" }]);
    expect(aView.items).toEqual([{ unit_price: 500 }]);
  });
});
