const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export function saveTokens(db: ReturnType<typeof DatabaseSync>, tokens: AuthTokens): void {
  db.prepare(
    `INSERT INTO auth_tokens (id, access_token, refresh_token, expires_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at`
  ).run(tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
}

export function getTokens(db: ReturnType<typeof DatabaseSync>): AuthTokens | null {
  const row = db
    .prepare("SELECT access_token, refresh_token, expires_at FROM auth_tokens WHERE id = 1")
    .get() as { access_token: string; refresh_token: string; expires_at: string } | undefined;
  if (!row) return null;
  return { accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at };
}
