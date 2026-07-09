import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { saveTokens } from "@/db/tokens";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

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
  saveTokens(getDb(), { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt });

  return NextResponse.redirect(new URL("/", request.url));
}
