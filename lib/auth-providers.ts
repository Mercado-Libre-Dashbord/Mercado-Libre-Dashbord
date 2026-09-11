import type { Provider } from "next-auth/providers/index";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";

/**
 * Qué logins ofrece la app, armado en un solo lugar.
 *
 * Cada proveedor se enciende solo si tiene sus credenciales cargadas. Así
 * agregar Microsoft no obliga a nadie a registrar una app en Azure: quien no
 * complete esas variables sigue viendo únicamente el botón de Google, y la
 * pantalla de login no muestra un botón que va a fallar.
 */

export interface ProviderDescriptor {
  id: "google" | "azure-ad";
  /** Cómo se llama el botón en la pantalla de login. */
  label: string;
  configured: boolean;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function isGoogleConfigured(): boolean {
  return env("GOOGLE_CLIENT_ID").length > 0 && env("GOOGLE_CLIENT_SECRET").length > 0;
}

export function isMicrosoftConfigured(): boolean {
  return env("AZURE_AD_CLIENT_ID").length > 0 && env("AZURE_AD_CLIENT_SECRET").length > 0;
}

/**
 * El tenant contra el que se registró la app en Entra ID.
 *
 * `common` (el default) admite tanto cuentas de empresa como personales
 * —Hotmail, Outlook.com, Live—, que es lo que se busca acá. Un GUID
 * concreto restringe el login al directorio de una sola organización.
 */
export function azureTenantId(): string {
  return env("AZURE_AD_TENANT_ID") || "common";
}

export function enabledProviders(): ProviderDescriptor[] {
  return [
    { id: "google", label: "Google", configured: isGoogleConfigured() },
    { id: "azure-ad", label: "Microsoft", configured: isMicrosoftConfigured() },
  ].filter((p): p is ProviderDescriptor => p.configured);
}

/**
 * Perfil de Entra ID.
 *
 * El mapeo por defecto de este proveedor pide la foto a Microsoft Graph en
 * cada login y, de paso, se queda solo con `email` — que en Entra ID puede
 * venir vacío aunque el token traiga `preferred_username` con el mail real, y
 * descarta `tid`/`xms_edov`, que son justo los claims con los que se decide si
 * al email se le puede creer (ver lib/auth-identity.ts).
 *
 * Por eso se mapea a mano: sin llamada extra a Graph —un login menos
 * dependiente de otro servicio— y con los claims de confianza intactos.
 */
export function mapMicrosoftProfile(profile: MicrosoftIdTokenClaims) {
  return {
    id: profile.sub,
    name: profile.name ?? null,
    email: profile.email ?? profile.preferred_username ?? null,
    image: null,
    tid: profile.tid ?? null,
    xms_edov: profile.xms_edov ?? null,
  };
}

export interface MicrosoftIdTokenClaims {
  sub: string;
  name?: string | null;
  email?: string | null;
  /** Entra ID manda acá el mail cuando no completa `email`. */
  preferred_username?: string | null;
  tid?: string | null;
  xms_edov?: boolean | null;
}

export function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  if (isGoogleConfigured()) {
    providers.push(
      GoogleProvider({
        clientId: env("GOOGLE_CLIENT_ID"),
        clientSecret: env("GOOGLE_CLIENT_SECRET"),
      })
    );
  }

  if (isMicrosoftConfigured()) {
    providers.push(
      AzureADProvider({
        clientId: env("AZURE_AD_CLIENT_ID"),
        clientSecret: env("AZURE_AD_CLIENT_SECRET"),
        tenantId: azureTenantId(),
        profile: mapMicrosoftProfile as never,
      })
    );
  }

  return providers;
}
