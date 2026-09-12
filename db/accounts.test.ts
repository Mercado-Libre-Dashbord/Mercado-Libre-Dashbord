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

  it("a new account starts without confirming its régimen fiscal, and setAccountTaxCondition confirms it", async () => {
    // Es lo que dispara el onboarding: sin este flag no hay forma de saber si
    // una cuenta nueva ya contestó o si nadie le preguntó todavía.
    const { withScope } = await import("./client");
    const { createAccount, setAccountTaxCondition, getAccountById } = await import("./accounts");
    const email = `nueva.${nanoid(6)}@example.com`;
    const account = await withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta Nueva", email));
    expect(account.taxConditionConfirmed).toBe(false);

    await withScope({ isAdmin: false, userEmail: email.toLowerCase() }, (client) =>
      setAccountTaxCondition(client, account.id, "monotributo")
    );

    const updated = await withScope({ isAdmin: true }, (client) => getAccountById(client, account.id));
    expect(updated?.taxCondition).toBe("monotributo");
    expect(updated?.taxConditionConfirmed).toBe(true);
  });

  it("a new account starts without orders_synced_through, and setOrdersSyncedThrough guarda el checkpoint", async () => {
    // Sin esto, el próximo sync no tiene de dónde sacar el atajo y recorre
    // el historial completo, como una cuenta que nunca sincronizó nada.
    const { withScope } = await import("./client");
    const { createAccount, setOrdersSyncedThrough, getAccountById } = await import("./accounts");
    const email = `checkpoint.${nanoid(6)}@example.com`;
    const account = await withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta con checkpoint", email));
    expect(account.ordersSyncedThrough).toBeNull();

    await withScope({ isAdmin: false, userEmail: email.toLowerCase() }, (client) =>
      setOrdersSyncedThrough(client, account.id, "2026-08-15")
    );

    const updated = await withScope({ isAdmin: true }, (client) => getAccountById(client, account.id));
    expect(updated?.ordersSyncedThrough).toBe("2026-08-15");
  });

  it("an admin can edit the name and owner email of an account", async () => {
    const { withScope } = await import("./client");
    const { createAccount, updateAccountDetails } = await import("./accounts");
    const email = `editar.${nanoid(6)}@example.com`;
    const account = await withScope({ isAdmin: true }, (client) => createAccount(client, "Nombre viejo", email));

    const newEmail = `nuevo.${nanoid(6)}@Example.com`;
    const updated = await withScope({ isAdmin: true }, (client) =>
      updateAccountDetails(client, account.id, { name: "Nombre nuevo", ownerEmail: newEmail })
    );

    expect(updated?.name).toBe("Nombre nuevo");
    // Se normaliza a minúsculas, igual que createAccount.
    expect(updated?.ownerEmail).toBe(newEmail.toLowerCase());
  });

  it("a non-admin cannot edit an account they don't own (RLS, not just app logic)", async () => {
    const { withScope } = await import("./client");
    const { createAccount, updateAccountDetails, getAccountById } = await import("./accounts");
    const email = `dueño.${nanoid(6)}@example.com`;
    const account = await withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta ajena", email));

    const updated = await withScope({ isAdmin: false, userEmail: "otro@example.com" }, (client) =>
      updateAccountDetails(client, account.id, { name: "Robado" })
    );

    // RLS deja el UPDATE en 0 filas en vez de tirar error: se refleja en null.
    expect(updated).toBeNull();
    const stillOriginal = await withScope({ isAdmin: true }, (client) => getAccountById(client, account.id));
    expect(stillOriginal?.name).toBe("Cuenta ajena");
  });

  it("an admin can delete an account that has no data yet", async () => {
    const { withScope } = await import("./client");
    const { createAccount, deleteAccount, getAccountById } = await import("./accounts");
    const email = `borrar.${nanoid(6)}@example.com`;
    const account = await withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta vacía", email));

    const deleted = await withScope({ isAdmin: true }, (client) => deleteAccount(client, account.id));

    expect(deleted).toBe(true);
    const gone = await withScope({ isAdmin: true }, (client) => getAccountById(client, account.id));
    expect(gone).toBeNull();
  });

  it("a non-admin cannot delete any account (RLS, not just app logic)", async () => {
    const { withScope } = await import("./client");
    const { createAccount, deleteAccount, getAccountById } = await import("./accounts");
    const email = `protegida.${nanoid(6)}@example.com`;
    const account = await withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta protegida", email));

    const deleted = await withScope({ isAdmin: false, userEmail: email.toLowerCase() }, (client) =>
      deleteAccount(client, account.id)
    );

    expect(deleted).toBe(false);
    const stillThere = await withScope({ isAdmin: true }, (client) => getAccountById(client, account.id));
    expect(stillThere).not.toBeNull();
  });

  it("deleting an account with real data (a product) fails on a foreign key, not silently cascading", async () => {
    const { withScope } = await import("./client");
    const { createAccount, deleteAccount } = await import("./accounts");
    const email = `condata.${nanoid(6)}@example.com`;
    const account = await withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta con datos", email));
    await withScope({ accountId: account.id }, (client) =>
      client.query(
        `INSERT INTO products (account_id, id, title, current_price, stock, updated_at) VALUES ($1, 'MLA1', 'Producto', 1000, 5, now())`,
        [account.id]
      )
    );

    await expect(withScope({ isAdmin: true }, (client) => deleteAccount(client, account.id))).rejects.toMatchObject({
      code: "23503",
    });
  });
});
