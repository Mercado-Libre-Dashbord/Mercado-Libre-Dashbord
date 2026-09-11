import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MICROSOFT_CONSUMER_TENANT_ID } from "./auth-identity";

const ENV_KEYS = ["ADMIN_EMAILS", "AZURE_AD_TENANT_ID", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetModules();
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

async function callbacks() {
  const { authOptions } = await import("./auth-options");
  return authOptions.callbacks!;
}

describe("signIn — puerta de entrada", () => {
  it("lets a verified Google login through", async () => {
    const cb = await callbacks();
    const allowed = await cb.signIn!({
      account: { provider: "google" },
      profile: { email: "vendedor@gmail.com", email_verified: true },
    } as never);
    expect(allowed).toBe(true);
  });

  it("lets a personal Hotmail account through", async () => {
    const cb = await callbacks();
    const allowed = await cb.signIn!({
      account: { provider: "azure-ad" },
      profile: { email: "vendedor@hotmail.com", tid: MICROSOFT_CONSUMER_TENANT_ID },
    } as never);
    expect(allowed).toBe(true);
  });

  it("blocks a Microsoft login whose email domain nobody verified", async () => {
    const cb = await callbacks();
    const allowed = await cb.signIn!({
      account: { provider: "azure-ad" },
      profile: { email: "duenio-de-la-cuenta@gmail.com", tid: "tenant-del-atacante" },
    } as never);
    expect(allowed).toBe(false);
  });

  it("blocks an unverified Google login", async () => {
    const cb = await callbacks();
    const allowed = await cb.signIn!({
      account: { provider: "google" },
      profile: { email: "vendedor@gmail.com", email_verified: false },
    } as never);
    expect(allowed).toBe(false);
  });

  it("does not leak the rejection reason to the user, only to the server log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cb = await callbacks();
    const allowed = await cb.signIn!({
      account: { provider: "azure-ad" },
      profile: { email: "x@gmail.com", tid: "otro" },
    } as never);
    expect(allowed).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("login rechazado"));
  });

  it("honours a single-tenant registration", async () => {
    process.env.AZURE_AD_TENANT_ID = "11111111-2222-3333-4444-555555555555";
    const cb = await callbacks();
    const allowed = await cb.signIn!({
      account: { provider: "azure-ad" },
      profile: { email: "ventas@empresa.com", tid: "11111111-2222-3333-4444-555555555555" },
    } as never);
    expect(allowed).toBe(true);
  });
});

describe("jwt / session", () => {
  it("normalizes the email so Google y Microsoft caen en la misma cuenta", async () => {
    const cb = await callbacks();
    const token = await cb.jwt!({ token: { email: "  Vendedor@Gmail.COM " } } as never);
    expect(token.email).toBe("vendedor@gmail.com");
  });

  it("marks an admin regardless of the casing the provider sent", async () => {
    process.env.ADMIN_EMAILS = "jefe@empresa.com, otro@empresa.com";
    const cb = await callbacks();
    const token = await cb.jwt!({ token: { email: "JEFE@Empresa.com" } } as never);
    expect(token.isAdmin).toBe(true);
  });

  it("does not make an admin out of an unrelated email", async () => {
    process.env.ADMIN_EMAILS = "jefe@empresa.com";
    const cb = await callbacks();
    const token = await cb.jwt!({ token: { email: "cliente@gmail.com" } } as never);
    expect(token.isAdmin).toBe(false);
  });

  it("remembers which provider was used across token refreshes", async () => {
    const cb = await callbacks();
    const first = await cb.jwt!({ token: { email: "v@hotmail.com" }, account: { provider: "azure-ad" } } as never);
    expect(first.provider).toBe("azure-ad");
    // Un refresh no trae `account`: el proveedor no se puede perder ahí.
    const refreshed = await cb.jwt!({ token: first } as never);
    expect(refreshed.provider).toBe("azure-ad");
  });

  it("copies isAdmin and provider onto the session", async () => {
    const cb = await callbacks();
    const session = await cb.session!({
      session: { user: { email: "v@hotmail.com" } },
      token: { isAdmin: true, provider: "azure-ad" },
    } as never);
    expect(session.user).toMatchObject({ isAdmin: true, provider: "azure-ad" });
  });
});
