import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

import { PATCH } from "./route";
import { getDb } from "@/db/client";

describe("PATCH /api/products", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when cost is missing or negative", async () => {
    const request = { json: async () => ({ productId: "MLA1", cost: -5 }) } as any;
    const res = await PATCH(request);
    expect(res.status).toBe(400);
  });

  it("inserts a new versioned cost row and returns ok", async () => {
    const run = vi.fn();
    vi.mocked(getDb).mockReturnValue({ prepare: () => ({ run }) } as any);
    const request = { json: async () => ({ productId: "MLA1", cost: 350 }) } as any;

    const res = await PATCH(request);

    expect(await res.json()).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith("MLA1", 350, expect.any(String));
  });
});
