import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/db/accounts", () => ({ getAccountById: vi.fn() }));
vi.mock("@/db/credentials", () => ({ createInvite: vi.fn(), getCredentialUserByEmail: vi.fn() }));
vi.mock("@/lib/current-account", () => ({ getCurrentUser: vi.fn() }));

import { POST } from "./route";
import { withScope } from "@/db/client";
import { getAccountById } from "@/db/accounts";
import { createInvite, getCredentialUserByEmail } from "@/db/credentials";
import { getCurrentUser } from "@/lib/current-account";

const req = (body: unknown) => ({ json: async () => body }) as any;
const account = {
  id: "acc1", name: "Cuenta", ownerEmail: "cliente@example.com", mlSellerId: null, otherTaxRate: 0,
  taxCondition: "responsable_inscripto" as const, taxConditionConfirmed: true, createdAt: "2026-01-01",
};

describe("POST /api/admin/credential-invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({}));
  });

  it("returns 403 for a non-admin", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "a@example.com", isAdmin: false });
    const res = await POST(req({ accountId: "acc1" }));
    expect(res.status).toBe(403);
    expect(withScope).not.toHaveBeenCalled();
  });

  it("returns 400 without accountId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the account doesn't exist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    vi.mocked(getAccountById).mockResolvedValue(null);
    const res = await POST(req({ accountId: "no-existe" }));
    expect(res.status).toBe(400);
  });

  it("usa siempre el owner_email de la cuenta, nunca un email suelto del body", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    vi.mocked(getAccountById).mockResolvedValue(account);
    vi.mocked(getCredentialUserByEmail).mockResolvedValue(null);

    const res = await POST(req({ accountId: "acc1", email: "otro-email-cualquiera@evil.com" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("cliente@example.com");
    expect(createInvite).toHaveBeenCalledWith(expect.anything(), "cliente@example.com", expect.any(String), expect.any(String));
    // El token en claro solo viaja en esta respuesta, nunca lo que se guarda en la base.
    const [, , storedHash] = vi.mocked(createInvite).mock.calls[0];
    expect(body.token).not.toBe(storedHash);
  });

  it("avisa si el email ya tenía una contraseña puesta", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    vi.mocked(getAccountById).mockResolvedValue(account);
    vi.mocked(getCredentialUserByEmail).mockResolvedValue({
      email: "cliente@example.com", passwordHash: "x", failedAttempts: 0, lockedUntil: null,
    });

    const body = await (await POST(req({ accountId: "acc1" }))).json();

    expect(body.hadPasswordAlready).toBe(true);
  });
});
