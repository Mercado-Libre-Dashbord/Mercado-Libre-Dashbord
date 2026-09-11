import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    /** `provider` es informativo (se muestra en el menú lateral): con qué
     * login entró el usuario. Nunca decide permisos — eso sale del email. */
    user?: DefaultSession["user"] & { isAdmin?: boolean; provider?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    isAdmin?: boolean;
    provider?: string;
  }
}
