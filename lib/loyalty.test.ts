import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, MISSIONS, hasEarnedReward, pointsToReward, totalPoints, validateConfig } from "./loyalty";

describe("totalPoints", () => {
  it("adds up the completed missions", () => {
    expect(totalPoints(DEFAULT_CONFIG, ["seguir_tienda", "dejar_opinion"])).toBe(1500);
  });

  it("does not pay twice for the same mission", () => {
    expect(totalPoints(DEFAULT_CONFIG, ["seguir_tienda", "seguir_tienda"])).toBe(1000);
  });

  it("is zero with nothing completed", () => {
    expect(totalPoints(DEFAULT_CONFIG, [])).toBe(0);
  });
});

describe("hasEarnedReward", () => {
  it("unlocks the coupon at the threshold, not past it", () => {
    expect(hasEarnedReward(DEFAULT_CONFIG, ["seguir_tienda"])).toBe(false);
    expect(hasEarnedReward(DEFAULT_CONFIG, ["seguir_tienda", "dejar_opinion"])).toBe(true);
  });

  it("reports how much is missing", () => {
    expect(pointsToReward(DEFAULT_CONFIG, ["seguir_tienda"])).toBe(500);
    expect(pointsToReward(DEFAULT_CONFIG, ["seguir_tienda", "dejar_opinion"])).toBe(0);
  });
});

describe("validateConfig", () => {
  it("accepts the defaults", () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
  });

  it("rejects a coupon worth more than the minimum purchase", () => {
    // Si no, el cupón regala plata en vez de incentivar una compra.
    const errors = validateConfig({ ...DEFAULT_CONFIG, rewardAmount: 5000, rewardMinPurchase: 1000 });
    expect(errors.map((e) => e.field)).toContain("rewardMinPurchase");
  });

  it("rejects a threshold nobody could ever reach", () => {
    const errors = validateConfig({ ...DEFAULT_CONFIG, rewardThreshold: 99999 });
    expect(errors[0].message).toContain("Nadie podría alcanzarlo");
  });

  it("rejects zero or negative values", () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, rewardThreshold: 0 }).length).toBeGreaterThan(0);
    expect(validateConfig({ ...DEFAULT_CONFIG, rewardAmount: 0 }).length).toBeGreaterThan(0);
  });
});

describe("MISSIONS", () => {
  it("only contains missions that happen inside Mercado Libre", () => {
    // Cualquier misión que saque al comprador de la plataforma es motivo de
    // suspensión: esto es una guarda contra agregar una sin pensarlo.
    const texto = MISSIONS.map((m) => `${m.label} ${m.description}`).join(" ").toLowerCase();
    for (const afuera of ["instagram", "tiktok", "facebook", "whatsapp", "web", "http"]) {
      expect(texto).not.toContain(afuera);
    }
  });

  it("rewards leaving an opinion without asking for a good one", () => {
    const opinion = MISSIONS.find((m) => m.id === "dejar_opinion")!;
    const texto = `${opinion.label} ${opinion.description}`.toLowerCase();
    for (const sesgo of ["positiv", "5 estrellas", "buena", "cinco"]) {
      expect(texto).not.toContain(sesgo);
    }
  });
});
