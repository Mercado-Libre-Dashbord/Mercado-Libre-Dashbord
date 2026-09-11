import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ withScope: vi.fn() }));
vi.mock("@/db/accounts", () => ({
  createAccount: vi.fn(),
  listAccounts: vi.fn(),
  updateAccountDetails: vi.fn(),
  deleteAccount: vi.fn(),
}));
vi.mock("@/lib/current-account", () => ({ getCurrentUser: vi.fn(), resolveCurrentAccount: vi.fn() }));

import { POST, PATCH, DELETE } from "./route";
import { withScope } from "@/db/client";
import { createAccount, updateAccountDetails, deleteAccount } from "@/db/accounts";
import { getCurrentUser } from "@/lib/current-account";

const req = (body: unknown) => ({ json: async () => body }) as any;
const account = {
  id: "acc1", name: "Cuenta", ownerEmail: "cliente@example.com", mlSellerId: null, otherTaxRate: 0,
  taxCondition: "responsable_inscripto" as const, taxConditionConfirmed: true, createdAt: "2026-01-01",
};

describe("POST /api/admin/accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({}));
  });

  it("returns 409 with a friendly message when the owner email is already in use", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    const dupError = Object.assign(new Error('duplicate key value violates unique constraint "accounts_owner_email_key"'), {
      code: "23505",
    });
    vi.mocked(createAccount).mockRejectedValue(dupError);

    const res = await POST(req({ name: "Cuenta nueva", ownerEmail: "cliente@example.com" }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Ya existe una cuenta");
  });

  it("re-throws unrelated database errors instead of masking them as a duplicate email", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    vi.mocked(createAccount).mockRejectedValue(new Error("connection lost"));

    await expect(POST(req({ name: "Cuenta nueva", ownerEmail: "cliente@example.com" }))).rejects.toThrow(
      "connection lost"
    );
  });
});

describe("PATCH /api/admin/accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({}));
  });

  it("returns 403 for a non-admin", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "a@example.com", isAdmin: false });
    const res = await PATCH(req({ accountId: "acc1", name: "Nuevo nombre" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 without accountId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    const res = await PATCH(req({ name: "Nuevo nombre" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither name nor ownerEmail is sent", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    const res = await PATCH(req({ accountId: "acc1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty name", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    const res = await PATCH(req({ accountId: "acc1", name: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the account doesn't exist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    vi.mocked(updateAccountDetails).mockResolvedValue(null);
    const res = await PATCH(req({ accountId: "no-existe", name: "X" }));
    expect(res.status).toBe(404);
  });

  it("edits the name and/or owner email", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    vi.mocked(updateAccountDetails).mockResolvedValue({ ...account, name: "Nuevo nombre" });

    const res = await PATCH(req({ accountId: "acc1", name: "Nuevo nombre" }));

    expect(res.status).toBe(200);
    expect(updateAccountDetails).toHaveBeenCalledWith(expect.anything(), "acc1", { name: "Nuevo nombre", ownerEmail: undefined });
  });

  it("returns 409 with a friendly message when the new owner email belongs to another account", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    const dupError = Object.assign(new Error('duplicate key value violates unique constraint "accounts_owner_email_key"'), {
      code: "23505",
    });
    vi.mocked(updateAccountDetails).mockRejectedValue(dupError);

    const res = await PATCH(req({ accountId: "acc1", ownerEmail: "otra-cuenta@example.com" }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Ya existe una cuenta");
  });

  it("re-throws unrelated database errors instead of masking them as a duplicate email", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    vi.mocked(updateAccountDetails).mockRejectedValue(new Error("connection lost"));

    await expect(PATCH(req({ accountId: "acc1", name: "X" }))).rejects.toThrow("connection lost");
  });
});

describe("DELETE /api/admin/accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withScope).mockImplementation((ctx: any, fn: any) => fn({}));
  });

  it("returns 403 for a non-admin", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "a@example.com", isAdmin: false });
    const res = await DELETE(req({ accountId: "acc1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 without accountId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    const res = await DELETE(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the account doesn't exist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    vi.mocked(deleteAccount).mockResolvedValue(false);
    const res = await DELETE(req({ accountId: "no-existe" }));
    expect(res.status).toBe(404);
  });

  it("deletes an empty account", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    vi.mocked(deleteAccount).mockResolvedValue(true);
    const res = await DELETE(req({ accountId: "acc1" }));
    expect(res.status).toBe(200);
  });

  it("returns 409 with a friendly message when the account still has real data (foreign key)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    const fkError = Object.assign(new Error("update or delete on table violates foreign key"), { code: "23503" });
    vi.mocked(deleteAccount).mockRejectedValue(fkError);

    const res = await DELETE(req({ accountId: "acc1" }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("datos asociados");
  });

  it("re-throws unrelated database errors instead of masking them as a foreign key conflict", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ email: "admin@example.com", isAdmin: true });
    vi.mocked(deleteAccount).mockRejectedValue(new Error("connection lost"));

    await expect(DELETE(req({ accountId: "acc1" }))).rejects.toThrow("connection lost");
  });
});
