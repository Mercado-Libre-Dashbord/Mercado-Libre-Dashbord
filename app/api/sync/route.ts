import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { runSync } from "@/sync/sync-service";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

export async function POST() {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!account.mlSellerId) {
    return NextResponse.json(
      { error: "Esta cuenta todavía no conectó Mercado Libre. Andá a /api/ml/login para autorizar." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const sinceResult = await db.execute({
    sql: `SELECT MAX(date_created) as latest FROM orders WHERE account_id = ?`,
    args: [account.id],
  });
  const latest = (sinceResult.rows[0] as any)?.latest as string | null;
  const sinceIso = latest ?? "2020-01-01T00:00:00Z";
  try {
    const result = await runSync(db, account.id, account.mlSellerId, sinceIso);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
