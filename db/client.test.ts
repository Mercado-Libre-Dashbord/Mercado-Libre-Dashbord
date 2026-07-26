import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://app_user:app_user_local_test_pw@localhost:5432/ml_dashboard_test";

describe("withScope", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  afterAll(async () => {
    const { closeDb } = await import("./client");
    await closeDb();
  });

  it("exposes the app.* session variables to the RLS helper functions", async () => {
    const { withScope } = await import("./client");
    const value = await withScope({ accountId: "probe-account", isAdmin: true, userEmail: "probe@example.com" }, async (client) => {
      const result = await client.query(
        "SELECT app_current_account_id() as account_id, app_is_admin() as is_admin, app_current_user_email() as email"
      );
      return result.rows[0];
    });
    expect(value).toEqual({ account_id: "probe-account", is_admin: true, email: "probe@example.com" });
  });

  it("does not leak session variables from one scope into the next connection use", async () => {
    const { withScope } = await import("./client");
    await withScope({ accountId: "acc-first" }, async () => undefined);
    const value = await withScope({}, async (client) => {
      const result = await client.query("SELECT app_current_account_id() as account_id");
      return result.rows[0].account_id;
    });
    expect(value).toBeNull();
  });
});
