import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, generateInviteToken, hashInviteToken, isValidInviteToken } from "./credentials-auth";

describe("hashPassword / verifyPassword", () => {
  it("verifica la contraseña correcta", async () => {
    const hash = await hashPassword("una-contraseña-segura");
    expect(await verifyPassword("una-contraseña-segura", hash)).toBe(true);
  });

  it("rechaza una contraseña incorrecta", async () => {
    const hash = await hashPassword("una-contraseña-segura");
    expect(await verifyPassword("otra-cosa", hash)).toBe(false);
  });

  it("dos hashes de la misma contraseña son distintos (salt por usuario)", async () => {
    const a = await hashPassword("misma-clave");
    const b = await hashPassword("misma-clave");
    expect(a).not.toBe(b);
    expect(await verifyPassword("misma-clave", a)).toBe(true);
    expect(await verifyPassword("misma-clave", b)).toBe(true);
  });

  it("nunca guarda la contraseña en claro dentro del hash almacenado", async () => {
    const hash = await hashPassword("no-deberia-aparecer-esto");
    expect(hash).not.toContain("no-deberia-aparecer-esto");
  });

  it("un hash con formato inválido no verifica ninguna contraseña", async () => {
    expect(await verifyPassword("cualquiera", "no-tiene-el-formato-salt:hash-esperado")).toBe(false);
    expect(await verifyPassword("cualquiera", "")).toBe(false);
  });
});

describe("invitaciones", () => {
  it("genera tokens distintos cada vez, y su hash es determinístico", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    expect(hashInviteToken(a)).toBe(hashInviteToken(a));
    expect(hashInviteToken(a)).not.toBe(hashInviteToken(b));
  });

  it("valida el formato esperado del token", () => {
    expect(isValidInviteToken(generateInviteToken())).toBe(true);
    expect(isValidInviteToken("cualquier-cosa")).toBe(false);
    expect(isValidInviteToken("")).toBe(false);
  });
});
