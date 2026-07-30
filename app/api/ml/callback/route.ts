import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { saveTokens } from "@/db/tokens";
import { setAccountMlSellerId } from "@/db/accounts";
import { getCurrentUser, resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const stateAccountId = request.nextUrl.searchParams.get("state");
  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }
  if (!stateAccountId) {
    return NextResponse.json({ error: "Missing state (account id)" }, { status: 400 });
  }

  // El `state` viaja por una URL que Mercado Libre controla y devuelve tal
  // cual — nunca es una prueba de identidad por sí solo. Antes de usarlo,
  // confirmamos que corresponde a la cuenta real de quien está logueado
  // ahora mismo (o a la cuenta que el admin tiene seleccionada), para que
  // nadie pueda pisar el token de otra cuenta armando este `state` a mano.
  const account = await resolveCurrentAccount();
  if (!account || account.id !== stateAccountId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const accountId = account.id;

  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.ML_CLIENT_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.ML_REDIRECT_URI!,
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Token exchange failed: ${await res.text()}` }, { status: 502 });
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  const user = await getCurrentUser();
  await withScope({ accountId, isAdmin: user?.isAdmin, userEmail: user?.email }, async (client) => {
    await saveTokens(client, accountId, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    });

    // El seller id lo confirmamos contra /users/me con el token recién emitido
    // en vez de confiar en un campo de la respuesta del token exchange.
    const meRes = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      await setAccountMlSellerId(client, accountId, String(me.id));
    }
  });

  return NextResponse.redirect(new URL("/", request.url));
}
