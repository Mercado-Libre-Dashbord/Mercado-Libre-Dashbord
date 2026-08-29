import type { QueryExecutor } from "./client";
import { DEFAULT_CONFIG, type LoyaltyConfig, type MissionId } from "@/lib/loyalty";

interface ProgramRow {
  active: boolean;
  points: Record<string, number> | null;
  reward_threshold: number;
  reward_amount: number;
  reward_min_purchase: number;
  reward_budget: number;
}

export interface StoredProgram extends LoyaltyConfig {
  rewardBudget: number;
}

export async function getProgram(db: QueryExecutor, accountId: string): Promise<StoredProgram> {
  const result = await db.query<ProgramRow>(`SELECT * FROM loyalty_programs WHERE account_id = $1`, [accountId]);
  const row = result.rows[0];
  // Sin fila configurada, el programa existe conceptualmente pero apagado:
  // así la UI puede mostrar los valores sugeridos sin escribir nada todavía.
  if (!row) return { ...DEFAULT_CONFIG, rewardBudget: 100000 };

  return {
    active: row.active,
    points: { ...DEFAULT_CONFIG.points, ...(row.points ?? {}) } as Record<MissionId, number>,
    rewardThreshold: Number(row.reward_threshold),
    rewardAmount: Number(row.reward_amount),
    rewardMinPurchase: Number(row.reward_min_purchase),
    rewardBudget: Number(row.reward_budget),
  };
}

export async function saveProgram(db: QueryExecutor, accountId: string, program: StoredProgram): Promise<void> {
  await db.query(
    `INSERT INTO loyalty_programs
       (account_id, active, points, reward_threshold, reward_amount, reward_min_purchase, reward_budget, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, now())
     ON CONFLICT (account_id) DO UPDATE SET
       active = excluded.active, points = excluded.points,
       reward_threshold = excluded.reward_threshold, reward_amount = excluded.reward_amount,
       reward_min_purchase = excluded.reward_min_purchase, reward_budget = excluded.reward_budget,
       updated_at = now()`,
    [
      accountId,
      program.active,
      JSON.stringify(program.points),
      program.rewardThreshold,
      program.rewardAmount,
      program.rewardMinPurchase,
      program.rewardBudget,
    ]
  );
}

export async function completedMissions(db: QueryExecutor, accountId: string, memberId: string): Promise<MissionId[]> {
  const result = await db.query<{ mission: string }>(
    `SELECT mission FROM loyalty_completions WHERE account_id = $1 AND member_id = $2`,
    [accountId, memberId]
  );
  return result.rows.map((r) => r.mission as MissionId);
}

/** Registra una misión. Idempotente: repetirla no vuelve a sumar puntos. */
export async function recordCompletion(
  db: QueryExecutor,
  accountId: string,
  memberId: string,
  mission: MissionId
): Promise<void> {
  await db.query(
    `INSERT INTO loyalty_completions (account_id, member_id, mission) VALUES ($1, $2, $3)
     ON CONFLICT (account_id, member_id, mission) DO NOTHING`,
    [accountId, memberId, mission]
  );
}

export async function upsertMember(
  db: QueryExecutor,
  accountId: string,
  memberId: string,
  info: { email?: string | null; name?: string | null }
): Promise<void> {
  await db.query(
    `INSERT INTO loyalty_members (account_id, member_id, email, name) VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, member_id) DO UPDATE SET
       email = COALESCE(excluded.email, loyalty_members.email),
       name = COALESCE(excluded.name, loyalty_members.name)`,
    [accountId, memberId, info.email ?? null, info.name ?? null]
  );
}

export async function getGrantedReward(
  db: QueryExecutor,
  accountId: string,
  memberId: string
): Promise<string | null> {
  const result = await db.query<{ reward_coupon_code: string | null }>(
    `SELECT reward_coupon_code FROM loyalty_members WHERE account_id = $1 AND member_id = $2`,
    [accountId, memberId]
  );
  return result.rows[0]?.reward_coupon_code ?? null;
}

export async function grantReward(
  db: QueryExecutor,
  accountId: string,
  memberId: string,
  couponCode: string
): Promise<void> {
  await db.query(
    `UPDATE loyalty_members SET reward_coupon_code = $3, reward_granted_at = now()
     WHERE account_id = $1 AND member_id = $2 AND reward_coupon_code IS NULL`,
    [accountId, memberId, couponCode]
  );
}

export interface MemberRow {
  memberId: string;
  name: string | null;
  email: string | null;
  joinedAt: string;
  missions: MissionId[];
  couponCode: string | null;
  grantedAt: string | null;
}

/**
 * Todos los miembros con sus misiones, en una sola consulta.
 *
 * Se agrega con array_agg en vez de pedir las misiones socio por socio: la
 * pantalla los muestra a todos juntos y una consulta por fila se degrada mal
 * apenas el programa funciona.
 */
export async function listMembers(db: QueryExecutor, accountId: string, limit = 200): Promise<MemberRow[]> {
  const result = await db.query<{
    member_id: string; name: string | null; email: string | null;
    joined_at: string | Date; missions: string[] | null;
    reward_coupon_code: string | null; reward_granted_at: string | Date | null;
  }>(
    `SELECT m.member_id, m.name, m.email, m.joined_at, m.reward_coupon_code, m.reward_granted_at,
            array_remove(array_agg(c.mission), NULL) as missions
       FROM loyalty_members m
       LEFT JOIN loyalty_completions c
         ON c.account_id = m.account_id AND c.member_id = m.member_id
      WHERE m.account_id = $1
      GROUP BY m.member_id, m.name, m.email, m.joined_at, m.reward_coupon_code, m.reward_granted_at
      ORDER BY m.joined_at DESC
      LIMIT $2`,
    [accountId, limit]
  );

  return result.rows.map((r) => ({
    memberId: r.member_id,
    name: r.name,
    email: r.email,
    joinedAt: new Date(r.joined_at).toISOString(),
    missions: (r.missions ?? []) as MissionId[],
    couponCode: r.reward_coupon_code,
    grantedAt: r.reward_granted_at ? new Date(r.reward_granted_at).toISOString() : null,
  }));
}

export interface MissionTally {
  mission: MissionId;
  count: number;
}

/** Cuántas veces se cumplió cada misión. Dice qué incentivo funciona. */
export async function missionTally(db: QueryExecutor, accountId: string): Promise<MissionTally[]> {
  const result = await db.query<{ mission: string; count: string }>(
    `SELECT mission, COUNT(*)::int as count FROM loyalty_completions
      WHERE account_id = $1 GROUP BY mission ORDER BY COUNT(*) DESC`,
    [accountId]
  );
  return result.rows.map((r) => ({ mission: r.mission as MissionId, count: Number(r.count) }));
}
