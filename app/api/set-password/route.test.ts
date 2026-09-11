import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/db/credentials", () => ({
  getInviteByTokenHash: vi.fn(),
  setCredentialPassword: vi.fn(),
  markInviteUsed: vi.fn(),
}));

import { POST } from "./route";
import { withScope } from "@/db/client";
import { getInviteByTokenHash, setCredentialPassword, markInviteUsed } from "@/db/credentials";
import { generateInviteToken } from "@/lib/credentials-auth";

const req = (body: unknown) => ({ json: async () => body }) as any;

describe("POST /api/set-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({}));
  });

  it("rechaza un token con formato inválido sin tocar la base", async () => {
    const res = await POST(req({ token: "no-es-un-token-real", password: "contraseña-valida" }));
    expect(res.status).toBe(400);
    expect(withScope).not.toHaveBeenCalled();
  });

  it("rechaza una contraseña demasiado corta", async () => {
    const res = await POST(req({ token: generateInviteToken(), password: "corta" }));
    expect(res.status).toBe(400);
  });

  it("rechaza si la invitación no existe", async () => {
    vi.mocked(getInviteByTokenHash).mockResolvedValue(null);
    const res = await POST(req({ token: generateInviteToken(), password: "contraseña-valida" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("no existe");
  });

  it("rechaza una invitación ya usada", async () => {
    vi.mocked(getInviteByTokenHash).mockResolvedValue({
      email: "cliente@example.com", expiresAt: new Date(Date.now() + 86400000).toISOString(), usedAt: new Date().toISOString(),
    });
    const res = await POST(req({ token: generateInviteToken(), password: "contraseña-valida" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("ya se usó");
  });

  it("rechaza una invitación vencida", async () => {
    vi.mocked(getInviteByTokenHash).mockResolvedValue({
      email: "cliente@example.com", expiresAt: new Date(Date.now() - 1000).toISOString(), usedAt: null,
    });
    const res = await POST(req({ token: generateInviteToken(), password: "contraseña-valida" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("venció");
  });

  it("con una invitación válida, guarda el hash y marca la invitación usada", async () => {
    vi.mocked(getInviteByTokenHash).mockResolvedValue({
      email: "cliente@example.com", expiresAt: new Date(Date.now() + 86400000).toISOString(), usedAt: null,
    });
    vi.mocked(setCredentialPassword).mockResolvedValue(true);

    const res = await POST(req({ token: generateInviteToken(), password: "contraseña-valida" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, email: "cliente@example.com" });
    // La contraseña que llega a setCredentialPassword nunca es la de texto
    // plano que mandó el cliente.
    const [, savedHash] = vi.mocked(setCredentialPassword).mock.calls[0];
    expect(savedHash).not.toBe("contraseña-valida");
    expect(markInviteUsed).toHaveBeenCalled();
  });

  it("si RLS termina rechazando el guardado (0 filas), no marca la invitación como usada", async () => {
    vi.mocked(getInviteByTokenHash).mockResolvedValue({
      email: "cliente@example.com", expiresAt: new Date(Date.now() + 86400000).toISOString(), usedAt: null,
    });
    vi.mocked(setCredentialPassword).mockResolvedValue(false);

    const res = await POST(req({ token: generateInviteToken(), password: "contraseña-valida" }));

    expect(res.status).toBe(400);
    expect(markInviteUsed).not.toHaveBeenCalled();
  });
});
