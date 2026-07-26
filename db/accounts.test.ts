import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://app_user:app_user_local_test_pw@localhost:5432/ml_dashboard_test";

describe("accounts", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  afterAll(async () => {
    const { closeDb } = await import("./client");
    await closeDb();
  });

  it("creates an account and finds it by owner email (case-insensitive)", async () => {
    const { withScope } = await import("./client");
    const { createAccount, getAccountByOwnerEmail } = await import("./accounts");
    const email = `Juan.${nanoid(6)}@Example.com`;

    const created = await withScope({ isAdmin: true }, (client) => createAccount(client, "Tienda de Juan", email));
    const found = await withScope({ isAdmin: true, userEmail: email.toLowerCase() }, (client) =>
      getAccountByOwnerEmail(client, email.toLowerCase())
    );

    expect(found).toEqual(created);
  });

  it("returns null for an owner email with no account", async () => {
    const { withScope } = await import("./client");
    const { getAccountByOwnerEmail } = await import("./accounts");
    const result = await withScope({ isAdmin: true }, (client) => getAccountByOwnerEmail(client, "nadie-nunca@example.com"));
    expect(result).toBeNull();
  });

  it("a non-admin cannot list accounts belonging to other owners", async () => {
    const { withScope } = await import("./client");
    const { createAccount, listAccounts } = await import("./accounts");
    const ownerEmail = `owner.${nanoid(6)}@example.com`;
    await withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta Privada", ownerEmail));

    const visibleToStranger = await withScope({ isAdmin: false, userEmail: "stranger@example.com" }, (client) =>
      listAccounts(client)
    );
    expect(visibleToStranger.find((a) => a.ownerEmail === ownerEmail.toLowerCase())).toBeUndefined();

    const visibleToOwner = await withScope({ isAdmin: false, userEmail: ownerEmail.toLowerCase() }, (client) =>
      listAccounts(client)
    );
    expect(visibleToOwner.map((a) => a.ownerEmail)).toEqual([ownerEmail.toLowerCase()]);
  });

  it("rejects creating an account when the caller is not an admin (RLS, not just app logic)", async () => {
    const { withScope } = await import("./client");
    const { createAccount } = await import("./accounts");
    await expect(
      withScope({ isAdmin: false, userEmail: "not-admin@example.com" }, (client) =>
        createAccount(client, "Cuenta Colada", `sneaky.${nanoid(6)}@example.com`)
      )
    ).rejects.toThrow();
  });

  it("sets the ml_seller_id once the account connects Mercado Libre", async () => {
    const { withScope } = await import("./client");
    const { createAccount, setAccountMlSellerId, getAccountById } = await import("./accounts");
    const email = `seller.${nanoid(6)}@example.com`;
    const account = await withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta Seller", email));

    // Mirrors lib/current-account.ts's getCurrentUser(): callers must pass an
    // already-lowercased email into withScope, since owner_email is stored
    // lowercased and the RLS policy does a plain string comparison.
    await withScope({ isAdmin: false, userEmail: email.toLowerCase() }, (client) =>
      setAccountMlSellerId(client, account.id, "123456789")
    );

    const updated = await withScope({ isAdmin: true }, (client) => getAccountById(client, account.id));
    expect(updated?.mlSellerId).toBe("123456789");
  });
});
