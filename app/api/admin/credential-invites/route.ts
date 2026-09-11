import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { getAccountById } from "@/db/accounts";
import { createInvite, getCredentialUserByEmail } from "@/db/credentials";
import { generateInviteToken, hashInviteToken, INVITE_EXPIRY_DAYS } from "@/lib/credentials-auth";
import { getCurrentUser } from "@/lib/current-account";

export const runtime = "nodejs";

/**
 * Genera una invitación de un solo uso para que el dueño de una cuenta
 * pueda poner una contraseña y entrar sin Google (ver migración 016). El
 * email SIEMPRE sale de la cuenta ya creada (nunca de lo que mande el
 * cliente de esta request) — así la invitación cae siempre sobre la cuenta
 * correcta, sin depender de que el admin tipee bien un email suelto.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { accountId } = body as { accountId?: string };
  if (!accountId) return NextResponse.json({ error: "accountId es requerido" }, { status: 400 });

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86400000).toISOString();

  const result = await withScope({ isAdmin: true, userEmail: user.email }, async (client) => {
    const account = await getAccountById(client, accountId);
    if (!account) return { error: "No se encontró esa cuenta." as const };

    try {
      const existing = await getCredentialUserByEmail(client, account.ownerEmail);
      await createInvite(client, account.ownerEmail, tokenHash, expiresAt);
      return { email: account.ownerEmail, hadPasswordAlready: existing !== null };
    } catch {
      return { error: "Falta correr db/postgres/migrations/016-login-credenciales.sql." as const };
    }
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ token, email: result.email, expiresAt, hadPasswordAlready: result.hadPasswordAlready });
}
