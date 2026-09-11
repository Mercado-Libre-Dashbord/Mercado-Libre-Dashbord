import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "AZURE_AD_CLIENT_ID", "AZURE_AD_CLIENT_SECRET", "AZURE_AD_TENANT_ID",
  "ADMIN_EMAILS",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetModules();
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function load() {
  return import("./auth-providers");
}

describe("buildProviders", () => {
  it("offers no provider when nothing is configured", async () => {
    const { buildProviders, enabledProviders } = await load();
    expect(buildProviders()).toHaveLength(0);
    expect(enabledProviders()).toHaveLength(0);
  });

  it("keeps working with Google alone — agregar Microsoft no obliga a configurarlo", async () => {
    process.env.GOOGLE_CLIENT_ID = "gid";
    process.env.GOOGLE_CLIENT_SECRET = "gsecret";
    const { buildProviders, enabledProviders } = await load();
    expect(buildProviders().map((p: any) => p.id)).toEqual(["google"]);
    expect(enabledProviders().map((p) => p.id)).toEqual(["google"]);
  });

  it("adds Microsoft once its credentials are present", async () => {
    process.env.GOOGLE_CLIENT_ID = "gid";
    process.env.GOOGLE_CLIENT_SECRET = "gsecret";
    process.env.AZURE_AD_CLIENT_ID = "aid";
    process.env.AZURE_AD_CLIENT_SECRET = "asecret";
    const { buildProviders } = await load();
    expect(buildProviders().map((p: any) => p.id)).toEqual(["google", "azure-ad"]);
  });

  it("ignores credentials that are only whitespace", async () => {
    process.env.AZURE_AD_CLIENT_ID = "  ";
    process.env.AZURE_AD_CLIENT_SECRET = "asecret";
    const { isMicrosoftConfigured } = await load();
    expect(isMicrosoftConfigured()).toBe(false);
  });

  it("defaults to the 'common' tenant so Hotmail y cuentas de empresa entran igual", async () => {
    const { azureTenantId } = await load();
    expect(azureTenantId()).toBe("common");
  });

  it("honours an explicit single tenant", async () => {
    process.env.AZURE_AD_TENANT_ID = "11111111-2222-3333-4444-555555555555";
    const { azureTenantId } = await load();
    expect(azureTenantId()).toBe("11111111-2222-3333-4444-555555555555");
  });
});

describe("mapMicrosoftProfile", () => {
  it("keeps the claims the trust rules need instead of dropping them", async () => {
    const { mapMicrosoftProfile } = await load();
    expect(
      mapMicrosoftProfile({ sub: "u1", name: "Vendedor", email: "v@hotmail.com", tid: "t1", xms_edov: true })
    ).toMatchObject({ id: "u1", email: "v@hotmail.com", tid: "t1", xms_edov: true });
  });

  it("falls back to preferred_username when Entra ID sends no email claim", async () => {
    const { mapMicrosoftProfile } = await load();
    expect(mapMicrosoftProfile({ sub: "u1", preferred_username: "v@empresa.com", tid: "t1" }).email).toBe(
      "v@empresa.com"
    );
  });

  it("is the profile mapper the Microsoft provider actually gets", async () => {
    // next-auth mergea `options` por encima de la config del proveedor, así
    // que el mapeo de arriba es el que corre en un login real. Si un día
    // dejara de pasarse, los logins de empresa se rechazarían en silencio
    // por falta de `tid`/`xms_edov`.
    process.env.AZURE_AD_CLIENT_ID = "aid";
    process.env.AZURE_AD_CLIENT_SECRET = "asecret";
    const { buildProviders, mapMicrosoftProfile } = await load();
    const microsoft = buildProviders().find((p: any) => p.id === "azure-ad") as any;
    expect(microsoft.options.profile).toBe(mapMicrosoftProfile);
  });
});
