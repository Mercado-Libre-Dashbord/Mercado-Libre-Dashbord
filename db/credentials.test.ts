import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";

// Como db/rls-isolation.test.ts: esto es lo que de verdad importa acá. No
// alcanza con que el código de la app "se acuerde" de chequear la
// invitación — tiene que ser Postgres, vía RLS, el que lo impida aunque el
// código tuviera un bug. Se corre contra Postgres real, sin mockear nada.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://app_user:app_user_local_test_pw@localhost:5432/ml_dashboard_test";

// nanoid usa mayúsculas y minúsculas por default. db/credentials.ts guarda
// el email siempre en minúsculas (ver el test dedicado a esto más abajo),
// pero la política de RLS compara `app.credential_lookup_email` tal cual
// se lo pasa quien llama a withScope, sin normalizar de su lado — como
// cualquier caller real (authorizeCredentials), acá se arma el email de
// prueba ya en minúsculas para no toparse con esa inconsistencia por una
// letra al azar que le tocó a nanoid.
const testEmail = (prefix: string) => `${prefix}.${nanoid(6)}@example.com`.toLowerCase();

describe("credential login (real Postgres, not mocked)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  afterAll(async () => {
    const { closeDb } = await import("./client");
    await closeDb();
  });

  it("no se puede poner una contraseña sin una invitación válida para ese email", async () => {
    const { withScope } = await import("./client");
    const { setCredentialPassword } = await import("./credentials");
    const email = testEmail("nadie");

    // Sin credentialInviteHash en el scope: ninguna invitación "conocida".
    const saved = await withScope({}, (client) => setCredentialPassword(client, email, "hash-cualquiera"));

    expect(saved).toBe(false);
    const found = await withScope({ isAdmin: true }, async (client) => {
      const result = await client.query(`SELECT 1 FROM credential_users WHERE email = $1`, [email]);
      return result.rows.length;
    });
    expect(found).toBe(0);
  });

  it("con una invitación válida, la contraseña se guarda y la invitación se puede marcar usada", async () => {
    const { withScope } = await import("./client");
    const { createInvite, getInviteByTokenHash, setCredentialPassword, markInviteUsed } = await import("./credentials");
    const { hashInviteToken } = await import("../lib/credentials-auth");
    const email = testEmail("cliente");
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    await withScope({ isAdmin: true }, (client) => createInvite(client, email, tokenHash, expiresAt));

    const saved = await withScope({ credentialInviteHash: tokenHash }, (client) =>
      setCredentialPassword(client, email, "hash-real")
    );
    expect(saved).toBe(true);

    await withScope({ credentialInviteHash: tokenHash }, (client) => markInviteUsed(client, tokenHash));

    const invite = await withScope({ credentialInviteHash: tokenHash }, (client) => getInviteByTokenHash(client, tokenHash));
    expect(invite?.usedAt).not.toBeNull();
  });

  it("una invitación ya usada no sirve para volver a escribir la contraseña", async () => {
    const { withScope } = await import("./client");
    const { createInvite, setCredentialPassword, markInviteUsed } = await import("./credentials");
    const { hashInviteToken } = await import("../lib/credentials-auth");
    const email = testEmail("reuso");
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    await withScope({ isAdmin: true }, (client) => createInvite(client, email, tokenHash, expiresAt));
    await withScope({ credentialInviteHash: tokenHash }, (client) => setCredentialPassword(client, email, "hash-1"));
    await withScope({ credentialInviteHash: tokenHash }, (client) => markInviteUsed(client, tokenHash));

    // Alguien intenta reusar el mismo link para cambiar la contraseña de nuevo.
    const savedAgain = await withScope({ credentialInviteHash: tokenHash }, (client) =>
      setCredentialPassword(client, email, "hash-2")
    );
    expect(savedAgain).toBe(false);
  });

  it("una invitación vencida no sirve, aunque no se haya usado todavía", async () => {
    const { withScope } = await import("./client");
    const { createInvite, setCredentialPassword } = await import("./credentials");
    const { hashInviteToken } = await import("../lib/credentials-auth");
    const email = testEmail("vencida");
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() - 1000).toISOString(); // ya vencida

    await withScope({ isAdmin: true }, (client) => createInvite(client, email, tokenHash, expiresAt));
    const saved = await withScope({ credentialInviteHash: tokenHash }, (client) =>
      setCredentialPassword(client, email, "hash-1")
    );
    expect(saved).toBe(false);
  });

  it("una invitación con el token de OTRO email no deja escribir la contraseña de un tercero", async () => {
    const { withScope } = await import("./client");
    const { createInvite, setCredentialPassword } = await import("./credentials");
    const { hashInviteToken } = await import("../lib/credentials-auth");
    const invitedEmail = testEmail("invitado");
    const targetEmail = testEmail("victima");
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    // La invitación es para invitedEmail, pero se intenta usar ese mismo
    // token (ya válido) para poner una contraseña en OTRO email.
    await withScope({ isAdmin: true }, (client) => createInvite(client, invitedEmail, tokenHash, expiresAt));
    const saved = await withScope({ credentialInviteHash: tokenHash }, (client) =>
      setCredentialPassword(client, targetEmail, "hash-1")
    );
    expect(saved).toBe(false);
  });

  it("buscar por un email candidato nunca devuelve la fila de otro email", async () => {
    const { withScope } = await import("./client");
    const { createInvite, setCredentialPassword, getCredentialUserByEmail } = await import("./credentials");
    const { hashInviteToken } = await import("../lib/credentials-auth");
    const email = testEmail("real");
    const otroEmail = testEmail("impostor");
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    await withScope({ isAdmin: true }, (client) => createInvite(client, email, tokenHash, expiresAt));
    await withScope({ credentialInviteHash: tokenHash }, (client) => setCredentialPassword(client, email, "hash-1"));

    // Alguien intenta loguearse como "email" pero pidiendo la fila con el
    // scope de otro email candidato: RLS no debería dejarle ver nada.
    const seenAsImpostor = await withScope({ credentialLookupEmail: otroEmail }, (client) =>
      getCredentialUserByEmail(client, email)
    );
    expect(seenAsImpostor).toBeNull();

    const seenForReal = await withScope({ credentialLookupEmail: email }, (client) =>
      getCredentialUserByEmail(client, email)
    );
    expect(seenForReal?.email).toBe(email);
  });

  it("tras varios intentos fallidos, la cuenta queda bloqueada", async () => {
    const { withScope } = await import("./client");
    const { createInvite, setCredentialPassword, recordFailedLogin, getCredentialUserByEmail } = await import("./credentials");
    const { hashInviteToken } = await import("../lib/credentials-auth");
    const email = testEmail("bloqueo");
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    await withScope({ isAdmin: true }, (client) => createInvite(client, email, tokenHash, expiresAt));
    await withScope({ credentialInviteHash: tokenHash }, (client) => setCredentialPassword(client, email, "hash-1"));

    for (let i = 0; i < 5; i++) {
      await withScope({ credentialLookupEmail: email }, (client) => recordFailedLogin(client, email));
    }

    const user = await withScope({ credentialLookupEmail: email }, (client) => getCredentialUserByEmail(client, email));
    expect(user?.failedAttempts).toBe(5);
    expect(user?.lockedUntil).not.toBeNull();
    expect(new Date(user!.lockedUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  it("un login correcto resetea los intentos fallidos", async () => {
    const { withScope } = await import("./client");
    const { createInvite, setCredentialPassword, recordFailedLogin, recordSuccessfulLogin, getCredentialUserByEmail } = await import("./credentials");
    const { hashInviteToken } = await import("../lib/credentials-auth");
    const email = testEmail("recupera");
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    await withScope({ isAdmin: true }, (client) => createInvite(client, email, tokenHash, expiresAt));
    await withScope({ credentialInviteHash: tokenHash }, (client) => setCredentialPassword(client, email, "hash-1"));
    await withScope({ credentialLookupEmail: email }, (client) => recordFailedLogin(client, email));
    await withScope({ credentialLookupEmail: email }, (client) => recordFailedLogin(client, email));
    await withScope({ credentialLookupEmail: email }, (client) => recordSuccessfulLogin(client, email));

    const user = await withScope({ credentialLookupEmail: email }, (client) => getCredentialUserByEmail(client, email));
    expect(user?.failedAttempts).toBe(0);
    expect(user?.lockedUntil).toBeNull();
  });

  it("un admin puede crear la invitación aunque no conozca ningún token de antemano", async () => {
    const { withScope } = await import("./client");
    const { createInvite, getInviteByTokenHash } = await import("./credentials");
    const { hashInviteToken } = await import("../lib/credentials-auth");
    const email = testEmail("admin-crea");
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    await withScope({ isAdmin: true }, (client) => createInvite(client, email, tokenHash, expiresAt));

    const invite = await withScope({ isAdmin: true }, (client) => getInviteByTokenHash(client, tokenHash));
    // Se normaliza a minúsculas al guardar (ver el test de mayúsculas más
    // abajo) — nanoid puede generar el email de prueba con mayúsculas.
    expect(invite?.email).toBe(email.toLowerCase());
    expect(invite?.usedAt).toBeNull();
  });

  it("guarda el email siempre en minúsculas, sin importar cómo lo haya tipeado el admin", async () => {
    // Bug real que encontró un test end-to-end (lib/credentials-login-
    // isolation.test.ts): createInvite/setCredentialPassword no normalizaban
    // mayúsculas, mientras que authorizeCredentials sí lo hace antes de
    // buscar — un email con mayúsculas al crear la invitación terminaba sin
    // poder loguearse nunca, porque la fila quedaba guardada distinta a como
    // se la busca.
    //
    // OJO con este test: la política de RLS compara el email tal cual está
    // en `app.credential_lookup_email` (el scope de withScope), SIN
    // normalizar de su lado — esa normalización la tiene que hacer quien
    // llama, antes de armar el scope (como ya hace authorizeCredentials).
    // Por eso acá se arma el scope ya en minúsculas: lo que se está
    // probando es que la ESCRITURA normaliza sola, no que RLS matchee
    // mayúsculas distintas.
    const { withScope } = await import("./client");
    const { createInvite, setCredentialPassword, getCredentialUserByEmail } = await import("./credentials");
    const { hashInviteToken } = await import("../lib/credentials-auth");
    // A propósito con mayúsculas mezcladas, como podría tipear un admin.
    const mixedCaseEmail = `MixedCase.${nanoid(6)}@Example.COM`;
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    await withScope({ isAdmin: true }, (client) => createInvite(client, mixedCaseEmail, tokenHash, expiresAt));
    await withScope({ credentialInviteHash: tokenHash }, (client) => setCredentialPassword(client, mixedCaseEmail, "hash-1"));

    const found = await withScope({ credentialLookupEmail: mixedCaseEmail.toLowerCase() }, (client) =>
      getCredentialUserByEmail(client, mixedCaseEmail)
    );
    expect(found?.email).toBe(mixedCaseEmail.toLowerCase());
  });

  it("alguien sin ser admin no puede crear invitaciones para cualquier email", async () => {
    const { withScope } = await import("./client");
    const { createInvite } = await import("./credentials");
    const { hashInviteToken } = await import("../lib/credentials-auth");
    const tokenHash = hashInviteToken(`inv_${nanoid(20)}`);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    await expect(
      withScope({}, (client) => createInvite(client, "cualquiera@example.com", tokenHash, expiresAt))
    ).rejects.toThrow();
  });
});
