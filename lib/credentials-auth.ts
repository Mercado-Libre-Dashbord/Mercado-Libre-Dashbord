import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

/**
 * Login con email y contraseña para clientes sin cuenta de Google (ver
 * migración 016). scrypt es el módulo `crypto` nativo de Node — cero
 * paquetes nuevos, y a propósito lento/costoso de correr, que es justo lo
 * que se quiere de un hash de contraseña (dificulta la fuerza bruta offline
 * si alguna vez se filtra la base).
 */
const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LEN = 64;

export * from "./credentials-constants";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Compara en tiempo constante, igual que la clave de fidelización (ver
 * lib/loyalty-auth.ts) — con `===` el tiempo de respuesta filtra cuántos
 * bytes coinciden, suficiente para adivinar un hash a fuerza de intentos. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const derived = await scrypt(password, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

const INVITE_PREFIX = "inv_";

/** Token en claro. Se muestra una sola vez, al admin que genera la
 * invitación — igual que la clave de la app de fidelización. */
export function generateInviteToken(): string {
  return INVITE_PREFIX + randomBytes(24).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidInviteToken(token: string): boolean {
  return token.startsWith(INVITE_PREFIX) && token.length > INVITE_PREFIX.length + 20;
}
