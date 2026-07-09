import { getDb } from "@/db/client";
import { getTokens, saveTokens } from "@/db/tokens";
import { refreshAccessToken } from "./ml-client";

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export async function getValidAccessToken(): Promise<string> {
  const db = getDb();
  const tokens = getTokens(db);
  if (!tokens) {
    throw new Error("No hay tokens guardados. Autenticate en /api/auth/login primero.");
  }
  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (Date.now() < expiresAt - EXPIRY_BUFFER_MS) {
    return tokens.accessToken;
  }
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
  saveTokens(db, { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: newExpiresAt });
  return refreshed.accessToken;
}
