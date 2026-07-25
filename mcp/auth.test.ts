import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/tokens", () => ({ getTokens: vi.fn(), saveTokens: vi.fn() }));
vi.mock("./ml-client", () => ({ refreshAccessToken: vi.fn() }));

import { getValidAccessToken } from "./auth";
import { getTokens, saveTokens } from "@/db/tokens";
import { refreshAccessToken } from "./ml-client";

describe("getValidAccessToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when there are no saved tokens", async () => {
    vi.mocked(getTokens).mockResolvedValue(null);
    await expect(getValidAccessToken("acc1")).rejects.toThrow(/No hay tokens/);
  });

  it("returns the current token when it has not expired", async () => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: "valid",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const token = await getValidAccessToken("acc1");
    expect(token).toBe("valid");
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes and saves new tokens when close to expiring", async () => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: "old",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
    });
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: "new", refreshToken: "r2", expiresIn: 21600 });
    const token = await getValidAccessToken("acc1");
    expect(token).toBe("new");
    expect(saveTokens).toHaveBeenCalledWith(expect.anything(), "acc1", expect.objectContaining({ accessToken: "new" }));
  });
});
