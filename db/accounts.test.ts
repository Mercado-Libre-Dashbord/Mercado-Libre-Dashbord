import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";

const TEST_DB_PATH = "./data/test-accounts.db";

describe("accounts", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });
  afterEach(async () => {
    try {
      const mod = await import("./client");
      mod.closeDb();
    } catch {
      // Module might not be loaded
    }
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it("creates an account and finds it by owner email (case-insensitive)", async () => {
    const { getDb } = await import("./client");
    const { createAccount, getAccountByOwnerEmail } = await import("./accounts");
    const db = await getDb();
    const created = await createAccount(db, "Tienda de Juan", "Juan@Example.com");

    const found = await getAccountByOwnerEmail(db, "juan@example.com");
    expect(found).toEqual(created);
  });

  it("returns null for an owner email with no account", async () => {
    const { getDb } = await import("./client");
    const { getAccountByOwnerEmail } = await import("./accounts");
    const db = await getDb();
    expect(await getAccountByOwnerEmail(db, "nadie@example.com")).toBeNull();
  });

  it("lists accounts ordered by creation", async () => {
    const { getDb } = await import("./client");
    const { createAccount, listAccounts } = await import("./accounts");
    const db = await getDb();
    const a = await createAccount(db, "Cuenta A", "a@example.com");
    const b = await createAccount(db, "Cuenta B", "b@example.com");
    expect((await listAccounts(db)).map((acc) => acc.id)).toEqual([a.id, b.id]);
  });

  it("sets the ml_seller_id once the account connects Mercado Libre", async () => {
    const { getDb } = await import("./client");
    const { createAccount, setAccountMlSellerId, getAccountById } = await import("./accounts");
    const db = await getDb();
    const account = await createAccount(db, "Cuenta A", "a@example.com");
    await setAccountMlSellerId(db, account.id, "123456789");
    expect((await getAccountById(db, account.id))?.mlSellerId).toBe("123456789");
  });
});
