import type { Client } from "@libsql/client";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export async function saveTokens(db: Client, accountId: string, tokens: AuthTokens): Promise<void> {
  await db.execute({
    sql: `INSERT INTO auth_tokens (account_id, access_token, refresh_token, expires_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            expires_at = excluded.expires_at`,
    args: [accountId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt],
  });
}

export async function getTokens(db: Client, accountId: string): Promise<AuthTokens | null> {
  const result = await db.execute({
    sql: "SELECT access_token, refresh_token, expires_at FROM auth_tokens WHERE account_id = ?",
    args: [accountId],
  });
  const row = result.rows[0] as unknown as
    | { access_token: string; refresh_token: string; expires_at: string }
    | undefined;
  if (!row) return null;
  return { accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at };
}
