/**
 * Programa de fidelización, íntegramente dentro de Mercado Libre.
 *
 * Las misiones premian *acciones que ocurren dentro de la plataforma* — seguir
 * la tienda, dejar una opinión — y el premio es un cupón oficial de Mercado
 * Libre emitido por su propia API. Nada saca al comprador del ecosistema, que
 * es lo que hace que esto no sea sancionable: desviar tráfico afuera es la
 * causa más común de suspensión de cuentas.
 */

export type MissionId = "seguir_tienda" | "dejar_opinion" | "opinion_con_foto";

export interface Mission {
  id: MissionId;
  label: string;
  /** Qué ve el comprador. */
  description: string;
  defaultPoints: number;
}

/**
 * El catálogo es fijo a propósito: cada misión existe porque hay una acción
 * verificable del lado de Mercado Libre. Una misión que no se puede verificar
 * es una invitación a que la gente reclame puntos que no ganó.
 */
export const MISSIONS: Mission[] = [
  {
    id: "seguir_tienda",
    label: "Seguir la tienda",
    // Es la de mayor retorno: al seguir, el comprador queda alcanzado por el
    // canal de difusión, las historias y las notificaciones nativas de ML.
    description: "Seguí nuestra tienda oficial en Mercado Libre",
    defaultPoints: 1000,
  },
  {
    id: "dejar_opinion",
    label: "Dejar una opinión",
    // Se premia el acto de opinar, nunca la calificación: condicionar puntos a
    // una opinión positiva es manipulación de reseñas y está prohibido.
    description: "Contá qué te pareció el producto en Mis Compras",
    defaultPoints: 500,
  },
  {
    id: "opinion_con_foto",
    label: "Opinión con foto",
    description: "Sumá una foto a tu opinión",
    defaultPoints: 300,
  },
];

export const MISSION_BY_ID = new Map(MISSIONS.map((m) => [m.id, m]));

export interface LoyaltyConfig {
  /** Puntos por misión, con la posibilidad de que el vendedor los ajuste. */
  points: Record<MissionId, number>;
  /** Puntos necesarios para desbloquear el cupón. */
  rewardThreshold: number;
  /** Descuento del cupón, en pesos. */
  rewardAmount: number;
  /** Compra mínima para poder usarlo. */
  rewardMinPurchase: number;
  active: boolean;
}

export const DEFAULT_CONFIG: LoyaltyConfig = {
  points: {
    seguir_tienda: 1000,
    dejar_opinion: 500,
    opinion_con_foto: 300,
  },
  // Alcanzable completando dos misiones: un umbral que no se alcanza nunca
  // desmotiva más que no tener programa.
  rewardThreshold: 1500,
  rewardAmount: 2000,
  rewardMinPurchase: 10000,
  active: false,
};

export function pointsFor(config: LoyaltyConfig, mission: MissionId): number {
  return config.points[mission] ?? MISSION_BY_ID.get(mission)?.defaultPoints ?? 0;
}

export function totalPoints(config: LoyaltyConfig, completed: MissionId[]): number {
  // Una misión repetida no suma dos veces: se cuentan las distintas.
  return [...new Set(completed)].reduce((sum, m) => sum + pointsFor(config, m), 0);
}

export function hasEarnedReward(config: LoyaltyConfig, completed: MissionId[]): boolean {
  return totalPoints(config, completed) >= config.rewardThreshold;
}

/** Cuánto le falta al comprador para el premio. 0 si ya lo alcanzó. */
export function pointsToReward(config: LoyaltyConfig, completed: MissionId[]): number {
  return Math.max(0, config.rewardThreshold - totalPoints(config, completed));
}

export interface ConfigValidationError {
  field: string;
  message: string;
}

/**
 * El programa se configura una vez y después emite cupones reales con plata
 * real, así que conviene rechazar los valores imposibles acá y no cuando ML
 * devuelva un error a mitad de un canje.
 */
export function validateConfig(config: LoyaltyConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  if (config.rewardThreshold <= 0) {
    errors.push({ field: "rewardThreshold", message: "El objetivo de puntos tiene que ser mayor a 0." });
  }
  if (config.rewardAmount <= 0) {
    errors.push({ field: "rewardAmount", message: "El cupón tiene que tener un valor mayor a 0." });
  }
  if (config.rewardMinPurchase < config.rewardAmount) {
    // Un cupón de $2.000 con compra mínima de $1.000 regala plata.
    errors.push({
      field: "rewardMinPurchase",
      message: "La compra mínima no puede ser menor al valor del cupón.",
    });
  }

  const maxAchievable = MISSIONS.reduce((sum, m) => sum + pointsFor(config, m.id), 0);
  if (config.rewardThreshold > maxAchievable) {
    errors.push({
      field: "rewardThreshold",
      message: `Nadie podría alcanzarlo: completando todas las misiones se llega a ${maxAchievable} puntos.`,
    });
  }

  return errors;
}
