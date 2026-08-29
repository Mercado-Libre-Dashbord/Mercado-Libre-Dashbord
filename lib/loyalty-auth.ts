import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Credencial de la app de fidelización (la billetera que capta al comprador).
 *
 * Es una clave por cuenta, no un login: del otro lado hay un servicio, no una
 * persona. Se guarda el hash SHA-256 y nunca la clave, así que una copia de
 * la base no alcanza para registrar misiones en nombre de nadie.
 */
const PREFIX = "mfl_";

/** Clave nueva en claro. Se muestra una vez y no se puede volver a ver. */
export function generateApiKey(): string {
  return PREFIX + randomBytes(24).toString("base64url");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Compara en tiempo constante. Con `===` el tiempo de respuesta depende de
 * cuántos caracteres coinciden, que es suficiente para adivinar un hash a
 * fuerza de intentos cronometrados.
 */
export function apiKeyMatches(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Lee la clave de `Authorization: Bearer ...`. Devuelve null si no viene. */
export function apiKeyFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const key = match?.[1]?.trim();
  return key && key.startsWith(PREFIX) ? key : null;
}

/** Para mostrar en la UI sin revelarla: `mfl_abcd…wxyz`. */
export function maskApiKey(key: string): string {
  return key.length <= 12 ? key : `${key.slice(0, 8)}…${key.slice(-4)}`;
}
