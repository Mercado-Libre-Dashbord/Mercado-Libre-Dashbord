import { NextResponse } from "next/server";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

export async function GET() {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json({ id: account.id, name: account.name, mlConnected: account.mlSellerId !== null });
}
