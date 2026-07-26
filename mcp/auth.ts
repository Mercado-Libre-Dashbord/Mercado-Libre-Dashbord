import { withScope } from "@/db/client";
import { getTokens, saveTokens } from "@/db/tokens";
import { refreshAccessToken } from "./ml-client";

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export async function getValidAccessToken(accountId: string): Promise<string> {
  return withScope({ accountId }, async (client) => {
    const tokens = await getTokens(client, accountId);
    if (!tokens) {
      throw new Error("No hay tokens guardados. Conectá Mercado Libre desde el dashboard primero.");
    }
    const expiresAt = new Date(tokens.expiresAt).getTime();
    if (Date.now() < expiresAt - EXPIRY_BUFFER_MS) {
      return tokens.accessToken;
    }
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
    await saveTokens(client, accountId, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: newExpiresAt,
    });
    return refreshed.accessToken;
  });
}
