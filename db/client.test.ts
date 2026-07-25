import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";

const TEST_DB_PATH = "./data/test-client.db";

describe("getDb", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(async () => {
    // Close the database connection
    try {
      const mod = await import("./client");
      mod.closeDb();
    } catch {
      // Module might not be loaded
    }

    // Delete the test database file
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("creates all expected tables", async () => {
    const { getDb } = await import("./client");
    const db = await getDb();
    const result = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = result.rows.map((r: any) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "accounts",
        "products",
        "product_costs",
        "orders",
        "order_items",
        "ads_spend",
        "auth_tokens",
      ])
    );
  });

  it("returns the same connection instance on repeated calls", async () => {
    const { getDb } = await import("./client");
    expect(await getDb()).toBe(await getDb());
  });
});
