import { describe, it, expect } from "vitest";
import { apiKeyFromHeader, apiKeyMatches, generateApiKey, hashApiKey, maskApiKey } from "./loyalty-auth";

describe("credencial de fidelización", () => {
  it("genera claves con prefijo reconocible y distintas entre sí", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).toMatch(/^mfl_/);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(24);
  });

  it("el hash es estable y no contiene la clave", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toContain(key.slice(4));
  });

  it("acepta el hash correcto y rechaza cualquier otro", () => {
    const stored = hashApiKey(generateApiKey());
    expect(apiKeyMatches(stored, stored)).toBe(true);
    expect(apiKeyMatches(hashApiKey(generateApiKey()), stored)).toBe(false);
  });

  it("no explota con un hash vacío o de largo distinto", () => {
    const stored = hashApiKey("x");
    expect(apiKeyMatches("", stored)).toBe(false);
    expect(apiKeyMatches("abcd", stored)).toBe(false);
  });

  it("lee la clave del header y descarta lo que no sea una credencial nuestra", () => {
    const key = generateApiKey();
    expect(apiKeyFromHeader(`Bearer ${key}`)).toBe(key);
    expect(apiKeyFromHeader(`bearer ${key}`)).toBe(key);
    // Un token de otra cosa (por ejemplo el de Mercado Libre) no se confunde
    // con una credencial de fidelización.
    expect(apiKeyFromHeader("Bearer APP_USR_123")).toBeNull();
    expect(apiKeyFromHeader(null)).toBeNull();
    expect(apiKeyFromHeader("mfl_sin-esquema")).toBeNull();
  });

  it("enmascara para poder mostrarla sin revelarla", () => {
    expect(maskApiKey("mfl_abcdefghijklmnop")).toBe("mfl_abcd…mnop");
  });
});
