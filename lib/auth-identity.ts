/**
 * Reglas de confianza sobre la identidad que devuelve cada proveedor de login.
 *
 * Toda la app identifica al vendedor por email: `accounts.owner_email` es
 * UNIQUE, las políticas de RLS comparan contra `app_current_user_email()` y
 * `ADMIN_EMAILS` decide quién ve todas las cuentas. Eso es lo que hace que
 * entrar con Google o con Microsoft caiga solo en la misma cuenta cuando el
 * email es el mismo — no hace falta vincular nada a mano.
 *
 * Y es también lo que lo vuelve delicado: si un proveedor nos deja poner
 * cualquier email en el token, quien lo controle entra a la cuenta ajena y,
 * si ese email está en ADMIN_EMAILS, a todas. Por eso el email no se acepta
 * porque sí: cada proveedor tiene que demostrar que verificó que ese buzón es
 * de quien dice ser. Lo que no se puede demostrar, se rechaza.
 */

/** Tenant de las cuentas personales de Microsoft (Hotmail, Outlook.com, Live). */
export const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

/** Tenants "virtuales" de Entra ID: no identifican un directorio concreto. */
const MULTI_TENANT_ALIASES = new Set(["common", "organizations", "consumers"]);

export type AuthProviderId = "google" | "azure-ad";

export interface ProviderProfile {
  email?: string | null;
  /** Google: si verificó el buzón. Llega como booleano o como string. */
  email_verified?: boolean | string | null;
  /** Entra ID: directorio del usuario. */
  tid?: string | null;
  /**
   * Entra ID: "email domain owner verified". Claim opcional que hay que
   * habilitar en el manifiesto de la app registrada (ver docs/login-microsoft.md).
   * Es la única señal directa de que el dominio del email fue validado.
   */
  xms_edov?: boolean | string | null;
  [key: string]: unknown;
}

export interface EmailTrustResult {
  trusted: boolean;
  /** Por qué se aceptó o se rechazó. Va al log del servidor, no al usuario. */
  reason: string;
}

/**
 * Normaliza el email para que las tres cosas que lo usan —el lookup por
 * `owner_email`, la variable de sesión de RLS y la lista de admins— comparen
 * siempre lo mismo. Ni Google ni Microsoft garantizan minúsculas.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = (email ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/** Un claim booleano puede llegar como `true` o como `"true"` según el proveedor. */
function claimIsTrue(value: boolean | string | null | undefined): boolean {
  return value === true || value === "true";
}

function claimIsFalse(value: boolean | string | null | undefined): boolean {
  return value === false || value === "false";
}

/**
 * Google firma `email_verified` y es confiable: sin ese claim en true el
 * buzón puede no ser del usuario.
 */
function trustGoogleEmail(profile: ProviderProfile): EmailTrustResult {
  if (claimIsTrue(profile.email_verified)) {
    return { trusted: true, reason: "google: email_verified=true" };
  }
  return { trusted: false, reason: "google: email_verified ausente o false" };
}

/**
 * Microsoft es el caso delicado, y no por paranoia: en una app multi-tenant
 * el claim `email` de Entra ID puede venir de un dominio que el directorio
 * nunca verificó. Cualquiera que pueda crear un tenant propio pone ahí el
 * email de otro y entra a su cuenta — es la vulnerabilidad que Microsoft
 * publicó como "nOAuth" y la razón por la que su propia guía dice no usar
 * `email` como identificador sin más.
 *
 * Se acepta el email solo cuando hay una razón concreta para creerle:
 *
 * 1. `xms_edov=true`: Entra ID confirma que el dominio del email está
 *    verificado por el directorio. Es la señal fuerte y la recomendada.
 * 2. Cuenta personal (Hotmail/Outlook/Live): el tenant de consumidores es
 *    uno solo y Microsoft valida el buzón al crear la cuenta — incluso
 *    cuando la cuenta se armó sobre un email de otro proveedor. Es
 *    justamente el caso "entro con mi Hotmail" que esto viene a habilitar.
 * 3. App registrada contra UN tenant concreto y el token viene de ese
 *    tenant: el directorio es el de la propia empresa, y quién tiene un
 *    email ahí adentro lo decide su administrador, no un desconocido.
 *
 * Un `xms_edov=false` explícito gana sobre todo lo demás: el proveedor está
 * diciendo que ese dominio no está verificado.
 */
function trustMicrosoftEmail(profile: ProviderProfile, configuredTenantId: string | null): EmailTrustResult {
  if (claimIsFalse(profile.xms_edov)) {
    return { trusted: false, reason: "azure-ad: xms_edov=false (dominio del email sin verificar)" };
  }
  if (claimIsTrue(profile.xms_edov)) {
    return { trusted: true, reason: "azure-ad: xms_edov=true" };
  }

  const tid = (profile.tid ?? "").trim().toLowerCase();
  if (tid === MICROSOFT_CONSUMER_TENANT_ID) {
    return { trusted: true, reason: "azure-ad: cuenta personal de Microsoft (tenant de consumidores)" };
  }

  const configured = (configuredTenantId ?? "").trim().toLowerCase();
  if (configured && !MULTI_TENANT_ALIASES.has(configured) && tid && tid === configured) {
    return { trusted: true, reason: "azure-ad: app de un solo tenant y el token viene de ese tenant" };
  }

  return {
    trusted: false,
    reason:
      "azure-ad: sin xms_edov y el token no viene ni del tenant de consumidores ni del tenant propio; " +
      "habilitá el claim opcional xms_edov en el manifiesto de la app (ver docs/login-microsoft.md)",
  };
}

export interface EmailTrustOptions {
  /** Valor de AZURE_AD_TENANT_ID con el que se registró la app. */
  azureTenantId?: string | null;
}

/**
 * Si el email que devolvió el proveedor alcanza para decidir a qué cuenta
 * entra el usuario. Lo que no pasa por acá no entra: es preferible un login
 * rechazado a un login que cae en la cuenta equivocada.
 */
export function isProviderEmailTrusted(
  provider: string,
  profile: ProviderProfile | null | undefined,
  options: EmailTrustOptions = {}
): EmailTrustResult {
  if (!profile) return { trusted: false, reason: `${provider}: el proveedor no devolvió perfil` };
  if (!normalizeEmail(profile.email)) {
    return { trusted: false, reason: `${provider}: el proveedor no devolvió email` };
  }

  if (provider === "google") return trustGoogleEmail(profile);
  if (provider === "azure-ad") return trustMicrosoftEmail(profile, options.azureTenantId ?? null);

  // Un proveedor que se agregue mañana y no pase por acá arranca sin
  // confianza a propósito: sumar un login nuevo obliga a decidir
  // explícitamente por qué se le cree el email.
  return { trusted: false, reason: `${provider}: proveedor sin regla de confianza definida` };
}
