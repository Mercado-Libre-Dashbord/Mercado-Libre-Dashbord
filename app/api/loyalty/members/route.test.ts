import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ resolveCurrentAccount: vi.fn() }));
vi.mock("@/mcp/tools", () => ({ createSellerCoupon: vi.fn() }));
vi.mock("@/db/loyalty", () => ({
  getProgram: vi.fn(),
  completedMissions: vi.fn(),
  recordCompletion: vi.fn(),
  upsertMember: vi.fn(),
  getGrantedReward: vi.fn(),
  grantReward: vi.fn(),
  listMembers: vi.fn(),
  missionTally: vi.fn(),
}));

import { GET, POST } from "./route";
import { withScope } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";
import { createSellerCoupon } from "@/mcp/tools";
import { completedMissions, getGrantedReward, getProgram, grantReward, listMembers, missionTally } from "@/db/loyalty";
import { resetColumnCache } from "@/db/schema-capabilities";
import { DEFAULT_CONFIG } from "@/lib/loyalty";

const account = { id: "acc1", name: "C", ownerEmail: "a@b.com", mlSellerId: "S1", otherTaxRate: 0, createdAt: "2026-01-01" };
const req = (body: unknown) => ({ json: async () => body }) as any;
const activeProgram = { ...DEFAULT_CONFIG, active: true, rewardBudget: 100000 };

function scope() {
  const query = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.columns")) {
      return { rows: [{ table_name: "loyalty_programs", column_name: "account_id" }] };
    }
    return { rows: [] };
  });
  vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
}

describe("POST /api/loyalty/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetColumnCache();
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
    vi.mocked(getProgram).mockResolvedValue(activeProgram);
    vi.mocked(getGrantedReward).mockResolvedValue(null);
    scope();
  });

  it("rejects an unknown mission instead of silently ignoring it", async () => {
    const res = await POST(req({ memberId: "m1", mission: "seguinos_en_instagram" }));
    expect(res.status).toBe(400);
  });

  it("requires a member id", async () => {
    expect((await POST(req({}))).status).toBe(400);
  });

  it("refuses to award points while the program is off", async () => {
    vi.mocked(getProgram).mockResolvedValue({ ...activeProgram, active: false });
    const res = await POST(req({ memberId: "m1", mission: "seguir_tienda" }));
    expect(res.status).toBe(409);
    expect(vi.mocked(createSellerCoupon)).not.toHaveBeenCalled();
  });

  it("tracks progress without issuing a coupon before the threshold", async () => {
    vi.mocked(completedMissions).mockResolvedValue(["seguir_tienda"]);

    const body = await (await POST(req({ memberId: "m1", mission: "seguir_tienda" }))).json();

    expect(body.points).toBe(1000);
    expect(body.pointsToReward).toBe(500);
    expect(body.rewardUnlocked).toBe(false);
    expect(vi.mocked(createSellerCoupon)).not.toHaveBeenCalled();
  });

  it("issues a real Mercado Libre coupon when the threshold is reached", async () => {
    vi.mocked(completedMissions).mockResolvedValue(["seguir_tienda", "dejar_opinion"]);
    vi.mocked(createSellerCoupon).mockResolvedValue({ id: "9", code: "GRACIAS10", status: "active" });

    const body = await (await POST(req({ memberId: "m1", mission: "dejar_opinion" }))).json();

    expect(body.rewardUnlocked).toBe(true);
    expect(body.couponCode).toBe("GRACIAS10");
    expect(vi.mocked(createSellerCoupon)).toHaveBeenCalledWith(
      "acc1",
      expect.objectContaining({ amount: 2000, minPurchase: 10000, budget: 100000 })
    );
    expect(vi.mocked(grantReward)).toHaveBeenCalledWith(expect.anything(), "acc1", "m1", "GRACIAS10");
  });

  it("never issues a second coupon to the same member", async () => {
    vi.mocked(completedMissions).mockResolvedValue(["seguir_tienda", "dejar_opinion"]);
    vi.mocked(getGrantedReward).mockResolvedValue("YA-EMITIDO");

    const body = await (await POST(req({ memberId: "m1" }))).json();

    expect(body.couponCode).toBe("YA-EMITIDO");
    // Reintentar el pedido no puede crear otra campaña en ML.
    expect(vi.mocked(createSellerCoupon)).not.toHaveBeenCalled();
  });
});

describe("GET /api/loyalty/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetColumnCache();
    vi.mocked(resolveCurrentAccount).mockResolvedValue(account);
    vi.mocked(getProgram).mockResolvedValue(activeProgram);
  });

  function membersScope() {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: [{ table_name: "loyalty_members", column_name: "member_id" }] };
      }
      return { rows: [] };
    });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));
  }

  it("returns 401 with no active account", async () => {
    vi.mocked(resolveCurrentAccount).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("counts points per member and totals the program", async () => {
    membersScope();
    vi.mocked(listMembers).mockResolvedValue([
      {
        memberId: "m1", name: "Ana", email: null, joinedAt: "2026-08-01T00:00:00.000Z",
        missions: ["seguir_tienda", "dejar_opinion"], couponCode: "ABC123", grantedAt: "2026-08-02T00:00:00.000Z",
      },
      {
        memberId: "m2", name: null, email: null, joinedAt: "2026-08-03T00:00:00.000Z",
        missions: ["seguir_tienda"], couponCode: null, grantedAt: null,
      },
    ]);
    vi.mocked(missionTally).mockResolvedValue([
      { mission: "seguir_tienda", count: 2 },
      { mission: "dejar_opinion", count: 1 },
    ]);

    const body = await (await GET()).json();

    expect(body.members[0]).toMatchObject({ memberId: "m1", points: 1500, pointsToReward: 0 });
    expect(body.members[1]).toMatchObject({ memberId: "m2", points: 1000, pointsToReward: 500 });
    expect(body.stats).toMatchObject({ members: 2, missionsCompleted: 3, couponsGranted: 1 });
  });

  it("reports the committed discount as a ceiling, not as money already spent", async () => {
    membersScope();
    vi.mocked(listMembers).mockResolvedValue([
      { memberId: "m1", name: null, email: null, joinedAt: "2026-08-01T00:00:00.000Z", missions: [], couponCode: "A", grantedAt: null },
      { memberId: "m2", name: null, email: null, joinedAt: "2026-08-01T00:00:00.000Z", missions: [], couponCode: "B", grantedAt: null },
    ]);
    vi.mocked(missionTally).mockResolvedValue([]);

    const body = await (await GET()).json();

    // 2 cupones x $2.000 de descuento, contra una compra mínima de $10.000.
    expect(body.stats.committedDiscount).toBe(2 * activeProgram.rewardAmount);
    expect(body.stats.potentialRevenue).toBe(2 * activeProgram.rewardMinPurchase);
  });

  it("says which migration is missing instead of failing with a 500", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({ query }));

    const res = await GET();

    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("009-loyalty.sql");
  });
});
