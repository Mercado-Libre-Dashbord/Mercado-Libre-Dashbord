import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";

// Nada mockeado a propósito: esto tiene que probar la cadena real completa
// que importa — login por contraseña -> qué email devuelve -> qué cuenta
// destraba ese email — con Postgres real, no con un `withScope` de mentira
// que "confía" en el scope que uno le pasa a mano.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://app_user:app_user_local_test_pw@localhost:5432/ml_dashboard_test";

describe("aislamiento entre cuentas para el login por contraseña (Postgres real)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  afterAll(async () => {
    const { closeDb } = await import("@/db/client");
    await closeDb();
  });

  /** Da de alta una contraseña real para el owner_email de una cuenta, tal
   * cual lo hace /api/set-password: invitación de admin -> hash real ->
   * escritura scopeada por el token, nunca "a mano". */
  async function setPasswordFor(email: string, password: string) {
    const { withScope } = await import("@/db/client");
    const { createInvite, setCredentialPassword, markInviteUsed } = await import("@/db/credentials");
    const { hashPassword, hashInviteToken } = await import("@/lib/credentials-auth");
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    await withScope({ isAdmin: true }, (client) => createInvite(client, email, tokenHash, expiresAt));
    const passwordHash = await hashPassword(password);
    await withScope({ credentialInviteHash: tokenHash }, (client) => setCredentialPassword(client, email, passwordHash));
    await withScope({ credentialInviteHash: tokenHash }, (client) => markInviteUsed(client, tokenHash));
  }

  it("logueándose como el dueño de la cuenta A, solo se destraba la cuenta A — nunca la B", async () => {
    const { withScope } = await import("@/db/client");
    const { createAccount, getAccountByOwnerEmail } = await import("@/db/accounts");
    const { authorizeCredentials } = await import("./auth-options");

    const emailA = `duenioa.${nanoid(6)}@example.com`;
    const emailB = `dueniob.${nanoid(6)}@example.com`;
    const accountA = await withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta A", emailA));
    const accountB = await withScope({ isAdmin: true }, (client) => createAccount(client, "Cuenta B", emailB));

    await setPasswordFor(emailA, "clave-super-segura-A");
    await setPasswordFor(emailB, "clave-super-segura-B");

    // 1) El login real (mismo código que corre /api/auth) tiene que
    // identificar a la persona como el email de A, nada más. Se normaliza a
    // minúsculas (igual que accounts.ownerEmail) — por eso se compara contra
    // la versión en minúsculas, no contra el email tal cual generó nanoid.
    const authResult = await authorizeCredentials({ email: emailA, password: "clave-super-segura-A" });
    expect(authResult).toEqual({ id: emailA.toLowerCase(), email: emailA.toLowerCase() });

    // 2) Con ESE email (no admin), exactamente lo mismo que hace
    // resolveCurrentAccount() para un usuario no-admin: solo puede ver la
    // cuenta cuyo owner_email es el suyo.
    const resolved = await withScope({ isAdmin: false, userEmail: authResult!.email }, (client) =>
      getAccountByOwnerEmail(client, authResult!.email)
    );
    expect(resolved?.id).toBe(accountA.id);

    // 3) Ni pidiendo la cuenta B por su id directamente, con el scope del
    // dueño de A, aparece nada — RLS decide, no un chequeo de "if" en la app.
    const { getAccountById } = await import("@/db/accounts");
    const attemptB = await withScope({ isAdmin: false, userEmail: authResult!.email }, (client) =>
      getAccountById(client, accountB.id)
    );
    expect(attemptB).toBeNull();

    // 4) Y la contraseña de A no destraba B, aunque alguien la probara ahí:
    // authorizeCredentials busca la fila por el EMAIL que se manda, no
    // "cualquier fila que matchee esta contraseña".
    const wrongAccountAttempt = await authorizeCredentials({ email: emailB, password: "clave-super-segura-A" });
    expect(wrongAccountAttempt).toBeNull();
  });

  it("los datos de una cuenta (productos) tampoco se filtran al loguearse como la otra", async () => {
    const { withScope } = await import("@/db/client");
    const { createAccount } = await import("@/db/accounts");
    const { authorizeCredentials } = await import("./auth-options");

    const emailA = `prod-a.${nanoid(6)}@example.com`;
    const emailB = `prod-b.${nanoid(6)}@example.com`;
    const accountA = await withScope({ isAdmin: true }, (client) => createAccount(client, "Tienda A", emailA));
    const accountB = await withScope({ isAdmin: true }, (client) => createAccount(client, "Tienda B", emailB));
    await setPasswordFor(emailA, "otra-clave-segura-A");
    await setPasswordFor(emailB, "otra-clave-segura-B");

    await withScope({ accountId: accountA.id }, (client) =>
      client.query(
        `INSERT INTO products (account_id, id, title, current_price, stock, updated_at) VALUES ($1, 'MLA1', 'Producto de A', 1000, 5, now())`,
        [accountA.id]
      )
    );
    await withScope({ accountId: accountB.id }, (client) =>
      client.query(
        `INSERT INTO products (account_id, id, title, current_price, stock, updated_at) VALUES ($1, 'MLA1', 'Producto de B', 2000, 3, now())`,
        [accountB.id]
      )
    );

    const authResult = await authorizeCredentials({ email: emailB, password: "otra-clave-segura-B" });
    expect(authResult?.email).toBe(emailB.toLowerCase());

    // Mismo id de producto en las dos cuentas a propósito (MLA1): si algo
    // se coló, acá aparecería el título de la cuenta A.
    const seenTitles = await withScope({ accountId: accountB.id }, async (client) => {
      const r = await client.query<{ title: string }>(`SELECT title FROM products WHERE id = 'MLA1'`);
      return r.rows.map((row) => row.title);
    });
    expect(seenTitles).toEqual(["Producto de B"]);
  });
});
