import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { createAccount, listAccounts } from "@/db/accounts";
import { getCurrentUser, resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const db = await getDb();
  const accounts = await listAccounts(db);
  const current = await resolveCurrentAccount();
  return NextResponse.json({
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, ownerEmail: a.ownerEmail, mlSellerId: a.mlSellerId })),
    currentAccountId: current?.id ?? null,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await request.json();
  const { name, ownerEmail } = body as { name?: string; ownerEmail?: string };
  if (!name || !ownerEmail) {
    return NextResponse.json({ error: "name y ownerEmail son requeridos" }, { status: 400 });
  }

  const db = await getDb();
  const account = await createAccount(db, name, ownerEmail);
  return NextResponse.json(account, { status: 201 });
}
