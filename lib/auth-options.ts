import type { NextAuthOptions } from "next-auth";
import { buildProviders, azureTenantId } from "./auth-providers";
import { isProviderEmailTrusted, normalizeEmail, type ProviderProfile } from "./auth-identity";

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

export const authOptions: NextAuthOptions = {
  providers: buildProviders(),
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    /**
     * Única puerta de entrada: acá se decide si al email que mandó el
     * proveedor se le puede creer.
     *
     * Es el punto crítico de toda la app. Todo lo de abajo —qué cuenta ve el
     * usuario, si es admin, qué filas le deja leer RLS— se resuelve a partir
     * de este email. Un proveedor que pueda poner uno ajeno en el token entra
     * a la cuenta de otro. Por eso un email sin verificar no entra, aunque el
     * login contra el proveedor haya salido bien.
     */
    async signIn({ account, profile }) {
      if (!account) return false;

      const trust = isProviderEmailTrusted(account.provider, profile as ProviderProfile | undefined, {
        azureTenantId: azureTenantId(),
      });

      if (!trust.trusted) {
        // Al servidor el motivo exacto; al usuario, nada más que no pudo
        // entrar. El detalle acá le diría a un atacante qué claim falsear.
        console.warn(`[auth] login rechazado — ${trust.reason}`);
        return false;
      }
      return true;
    },

    async jwt({ token, account }) {
      // Se normaliza una sola vez, acá, para que el lookup por owner_email, la
      // variable de sesión de RLS y la lista de admins comparen siempre igual.
      token.email = normalizeEmail(token.email) ?? token.email;
      // Solo viene en el login; en los refresh posteriores se conserva el que
      // ya estaba para no perder con qué proveedor entró.
      if (account?.provider) token.provider = account.provider;
      token.isAdmin = isAdminEmail(token.email);
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.isAdmin = token.isAdmin === true;
        session.user.provider = typeof token.provider === "string" ? token.provider : null;
      }
      return session;
    },
  },
};
