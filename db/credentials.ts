import type { QueryExecutor } from "./client";
import { MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES } from "@/lib/credentials-auth";

export interface CredentialUser {
  email: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: string | null;
}

interface CredentialUserRow {
  email: string;
  password_hash: string;
  failed_attempts: number;
  locked_until: string | Date | null;
}

function mapUser(row: CredentialUserRow): CredentialUser {
  return {
    email: row.email,
    passwordHash: row.password_hash,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until ? new Date(row.locked_until).toISOString() : null,
  };
}

/**
 * Se busca dentro de un `withScope({ credentialLookupEmail: email })` — la
 * política de RLS deja ver exactamente esa fila (ver migración 016), nunca
 * el resto de la tabla. Encontrar la fila NO significa que el login sea
 * válido: falta comparar la contraseña.
 */
export async function getCredentialUserByEmail(db: QueryExecutor, email: string): Promise<CredentialUser | null> {
  const result = await db.query<CredentialUserRow>(
    `SELECT email, password_hash, failed_attempts, locked_until FROM credential_users WHERE email = $1`,
    [email.trim().toLowerCase()]
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

/**
 * Crea o reemplaza la contraseña de un email. Solo puede tener efecto dentro
 * de un `withScope({ credentialInviteHash })` cuya invitación sea válida
 * para ese email (ver política `credential_users_write`) — sin eso, el
 * UPDATE/INSERT afecta 0 filas en vez de tirar un error, así que el valor de
 * retorno importa: decide si de verdad quedó guardada.
 */
export async function setCredentialPassword(db: QueryExecutor, email: string, passwordHash: string): Promise<boolean> {
  try {
    const result = await db.query<{ email: string }>(
      `INSERT INTO credential_users (email, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, failed_attempts = 0, locked_until = NULL
       RETURNING email`,
      [email.trim().toLowerCase(), passwordHash]
    );
    return result.rows.length > 0;
  } catch (err) {
    // A diferencia de un UPDATE (donde una fila que no matchea el USING
    // simplemente no se toca, sin error), un INSERT que no cumple el WITH
    // CHECK de RLS Postgres lo rechaza con un error — acá es exactamente
    // "no había invitación válida", el mismo caso que "0 filas afectadas"
    // en cualquier otro lado de este módulo.
    if ((err as { code?: string }).code === "42501") return false;
    throw err;
  }
}

/**
 * Suma un intento fallido y bloquea la cuenta un rato si se pasó del
 * máximo — sin esto, el endpoint de login es una puerta abierta a fuerza
 * bruta por diccionario contra una sola cuenta.
 *
 * Pasa por una función SECURITY DEFINER (no un UPDATE directo) a propósito:
 * en el momento de un intento de login ya no queda ninguna invitación
 * vigente (se usó para poner la contraseña original), así que una política
 * de RLS normal no dejaría avanzar el contador. La función solo sabe tocar
 * estas tres columnas — no es una puerta trasera para cambiar la contraseña.
 */
export async function recordFailedLogin(db: QueryExecutor, email: string): Promise<void> {
  await db.query(`SELECT credential_record_failed_login($1, $2, $3)`, [email.trim().toLowerCase(), MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES]);
}

export async function recordSuccessfulLogin(db: QueryExecutor, email: string): Promise<void> {
  await db.query(`SELECT credential_record_successful_login($1)`, [email.trim().toLowerCase()]);
}

export interface CredentialInvite {
  email: string;
  expiresAt: string;
  usedAt: string | null;
}

interface CredentialInviteRow {
  email: string;
  expires_at: string | Date;
  used_at: string | Date | null;
}

/** Se busca dentro de un `withScope({ credentialInviteHash })` — deja ver
 * solo la invitación de ese token (ver migración 016). */
export async function getInviteByTokenHash(db: QueryExecutor, tokenHash: string): Promise<CredentialInvite | null> {
  const result = await db.query<CredentialInviteRow>(
    `SELECT email, expires_at, used_at FROM credential_invites WHERE token_hash = $1`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    email: row.email,
    expiresAt: new Date(row.expires_at).toISOString(),
    usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
  };
}

/** Solo un admin puede crear invitaciones (ver política `credential_invites_insert`). */
export async function createInvite(
  db: QueryExecutor,
  email: string,
  tokenHash: string,
  expiresAt: string
): Promise<void> {
  await db.query(
    `INSERT INTO credential_invites (token_hash, email, expires_at) VALUES ($1, $2, $3)`,
    [tokenHash, email.trim().toLowerCase(), expiresAt]
  );
}

/** La marca usada el propio flujo de "poner contraseña", sin ser admin —
 * la política solo le deja tocar la fila de SU token. */
export async function markInviteUsed(db: QueryExecutor, tokenHash: string): Promise<void> {
  await db.query(`UPDATE credential_invites SET used_at = now() WHERE token_hash = $1`, [tokenHash]);
}
