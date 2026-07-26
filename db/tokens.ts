import type { QueryExecutor } from "./client";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export async function saveTokens(db: QueryExecutor, accountId: string, tokens: AuthTokens): Promise<void> {
  await db.query(
    `INSERT INTO auth_tokens (account_id, access_token, refresh_token, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at`,
    [accountId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt]
  );
}

export async function getTokens(db: QueryExecutor, accountId: string): Promise<AuthTokens | null> {
  const result = await db.query<{ access_token: string; refresh_token: string; expires_at: string | Date }>(
    "SELECT access_token, refresh_token, expires_at FROM auth_tokens WHERE account_id = $1",
    [accountId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}
