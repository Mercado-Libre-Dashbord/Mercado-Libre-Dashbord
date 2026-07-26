import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://app_user:app_user_local_test_pw@localhost:5432/ml_dashboard_test";

describe("saveTokens / getTokens", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  afterAll(async () => {
    const { closeDb } = await import("./client");
    await closeDb();
  });

  it("returns null when no tokens have been saved", async () => {
    const { withScope } = await import("./client");
    const { getTokens } = await import("./tokens");
    const result = await withScope({ accountId: `acc-${nanoid(6)}` }, (client) => getTokens(client, "no-such-account"));
    expect(result).toBeNull();
  });

  it("saves and retrieves tokens, overwriting on repeated save", async () => {
    const { withScope } = await import("./client");
    const { createAccount } = await import("./accounts");
    const { saveTokens, getTokens } = await import("./tokens");
    const account = await withScope({ isAdmin: true }, (client) =>
      createAccount(client, "Cuenta test", `tokens.${nanoid(6)}@example.com`)
    );

    await withScope({ accountId: account.id }, (client) =>
      saveTokens(client, account.id, { accessToken: "a1", refreshToken: "r1", expiresAt: "2026-01-01T00:00:00Z" })
    );
    await withScope({ accountId: account.id }, (client) =>
      saveTokens(client, account.id, { accessToken: "a2", refreshToken: "r2", expiresAt: "2026-01-02T00:00:00Z" })
    );

    const result = await withScope({ accountId: account.id }, (client) => getTokens(client, account.id));
    expect(result).toEqual({ accessToken: "a2", refreshToken: "r2", expiresAt: "2026-01-02T00:00:00.000Z" });
  });

  it("a request scoped to account A cannot read account B's tokens (RLS)", async () => {
    const { withScope } = await import("./client");
    const { createAccount } = await import("./accounts");
    const { saveTokens, getTokens } = await import("./tokens");
    const accountA = await withScope({ isAdmin: true }, (client) => createAccount(client, "A", `a.${nanoid(6)}@example.com`));
    const accountB = await withScope({ isAdmin: true }, (client) => createAccount(client, "B", `b.${nanoid(6)}@example.com`));
    await withScope({ accountId: accountB.id }, (client) =>
      saveTokens(client, accountB.id, { accessToken: "b-token", refreshToken: "b-refresh", expiresAt: "2026-01-01T00:00:00Z" })
    );

    const leaked = await withScope({ accountId: accountA.id }, (client) => getTokens(client, accountB.id));
    expect(leaked).toBeNull();
  });
});
