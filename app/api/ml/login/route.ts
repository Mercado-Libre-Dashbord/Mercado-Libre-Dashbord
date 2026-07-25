import { NextResponse } from "next/server";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

export async function GET() {
  const account = await resolveCurrentAccount();
  if (!account) {
    return NextResponse.json({ error: "No hay una cuenta activa para conectar" }, { status: 400 });
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.ML_CLIENT_ID!,
    redirect_uri: process.env.ML_REDIRECT_URI!,
    state: account.id,
  });
  return NextResponse.redirect(`https://auth.mercadolibre.com.ar/authorization?${params.toString()}`);
}
