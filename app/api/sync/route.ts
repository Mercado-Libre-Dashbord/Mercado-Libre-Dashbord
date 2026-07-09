import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { runSync } from "@/sync/sync-service";

export const runtime = "nodejs";

export async function POST() {
  const db = getDb();
  const sinceRow = db.prepare(`SELECT MAX(date_created) as latest FROM orders`).get() as { latest: string | null };
  const sinceIso = sinceRow.latest ?? "2020-01-01T00:00:00Z";
  try {
    const result = await runSync(db, process.env.ML_SELLER_ID!, sinceIso);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
