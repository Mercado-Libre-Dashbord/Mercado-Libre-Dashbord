import { describe, it, expect } from "vitest";
import {
  isProviderEmailTrusted,
  normalizeEmail,
  MICROSOFT_CONSUMER_TENANT_ID,
} from "./auth-identity";

describe("normalizeEmail", () => {
  it("lowercases and trims so RLS, el lookup y ADMIN_EMAILS comparan lo mismo", () => {
    expect(normalizeEmail("  Vendedor@Gmail.COM ")).toBe("vendedor@gmail.com");
  });

  it("treats blank as missing", () => {
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("isProviderEmailTrusted — Google", () => {
  it("accepts a verified email", () => {
    expect(
      isProviderEmailTrusted("google", { email: "a@example.com", email_verified: true }).trusted
    ).toBe(true);
  });

  it("accepts the claim as the string Google sometimes sends", () => {
    expect(
      isProviderEmailTrusted("google", { email: "a@example.com", email_verified: "true" }).trusted
    ).toBe(true);
  });

  it("rejects an unverified email", () => {
    expect(
      isProviderEmailTrusted("google", { email: "a@example.com", email_verified: false }).trusted
    ).toBe(false);
  });

  it("rejects when the claim is missing entirely", () => {
    expect(isProviderEmailTrusted("google", { email: "a@example.com" }).trusted).toBe(false);
  });
});

describe("isProviderEmailTrusted — Microsoft / Entra ID", () => {
  const tenant = "11111111-2222-3333-4444-555555555555";

  it("accepts a personal Hotmail/Outlook account", () => {
    const result = isProviderEmailTrusted(
      "azure-ad",
      { email: "vendedor@hotmail.com", tid: MICROSOFT_CONSUMER_TENANT_ID },
      { azureTenantId: "common" }
    );
    expect(result.trusted).toBe(true);
  });

  it("accepts an org account whose email domain the directory verified", () => {
    const result = isProviderEmailTrusted(
      "azure-ad",
      { email: "ventas@empresa.com", tid: tenant, xms_edov: true },
      { azureTenantId: "common" }
    );
    expect(result.trusted).toBe(true);
  });

  it("rejects a multi-tenant login with no proof the email domain is owned", () => {
    // El caso nOAuth: un tenant cualquiera pone el email de la víctima en el
    // token y, sin esta regla, entraría directo a su cuenta.
    const result = isProviderEmailTrusted(
      "azure-ad",
      { email: "victima@gmail.com", tid: "99999999-aaaa-bbbb-cccc-dddddddddddd" },
      { azureTenantId: "common" }
    );
    expect(result.trusted).toBe(false);
    expect(result.reason).toContain("xms_edov");
  });

  it("rejects an explicit xms_edov=false even from the app's own tenant", () => {
    const result = isProviderEmailTrusted(
      "azure-ad",
      { email: "ventas@sin-verificar.com", tid: tenant, xms_edov: false },
      { azureTenantId: tenant }
    );
    expect(result.trusted).toBe(false);
  });

  it("accepts a single-tenant app when the token comes from that same tenant", () => {
    const result = isProviderEmailTrusted(
      "azure-ad",
      { email: "ventas@empresa.com", tid: tenant },
      { azureTenantId: tenant }
    );
    expect(result.trusted).toBe(true);
  });

  it("rejects a token from a different tenant than the one the app is bound to", () => {
    const result = isProviderEmailTrusted(
      "azure-ad",
      { email: "ventas@empresa.com", tid: "otro-tenant" },
      { azureTenantId: tenant }
    );
    expect(result.trusted).toBe(false);
  });

  it("does not treat 'organizations' as a single tenant the app owns", () => {
    const result = isProviderEmailTrusted(
      "azure-ad",
      { email: "ventas@empresa.com", tid: "organizations" },
      { azureTenantId: "organizations" }
    );
    expect(result.trusted).toBe(false);
  });
});

describe("isProviderEmailTrusted — casos generales", () => {
  it("rejects a login with no email at all", () => {
    expect(isProviderEmailTrusted("google", { email_verified: true }).trusted).toBe(false);
    expect(isProviderEmailTrusted("azure-ad", { tid: MICROSOFT_CONSUMER_TENANT_ID }).trusted).toBe(false);
  });

  it("rejects when the provider returned no profile", () => {
    expect(isProviderEmailTrusted("google", null).trusted).toBe(false);
  });

  it("rejects an unknown provider by default", () => {
    // Sumar un login nuevo tiene que obligar a decidir por qué se le cree.
    expect(
      isProviderEmailTrusted("facebook", { email: "a@example.com", email_verified: true }).trusted
    ).toBe(false);
  });
});
