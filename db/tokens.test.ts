import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";

const TEST_DB_PATH = "./data/test-tokens.db";

describe("saveTokens / getTokens", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
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

  it("returns null when no tokens have been saved", async () => {
    const { getDb } = await import("./client");
    const { getTokens } = await import("./tokens");
    expect(getTokens(getDb())).toBeNull();
  });

  it("saves and retrieves tokens, overwriting on repeated save", async () => {
    const { getDb } = await import("./client");
    const { saveTokens, getTokens } = await import("./tokens");
    const db = getDb();
    saveTokens(db, { accessToken: "a1", refreshToken: "r1", expiresAt: "2026-01-01T00:00:00Z" });
    saveTokens(db, { accessToken: "a2", refreshToken: "r2", expiresAt: "2026-01-02T00:00:00Z" });
    expect(getTokens(db)).toEqual({ accessToken: "a2", refreshToken: "r2", expiresAt: "2026-01-02T00:00:00Z" });
  });
});
