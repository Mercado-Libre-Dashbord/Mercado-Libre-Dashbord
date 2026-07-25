import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

const MANUAL_CHANNELS = ["meta", "google", "tiktok"] as const;
type ManualChannel = (typeof MANUAL_CHANNELS)[number];

function isManualChannel(value: unknown): value is ManualChannel {
  return typeof value === "string" && (MANUAL_CHANNELS as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT id, date, amount, channel FROM ads_spend
          WHERE account_id = ? AND channel != 'mercado_ads' AND date BETWEEN ? AND ?
          ORDER BY date DESC`,
    args: [account.id, from, to],
  });
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { channel, date, amount } = body as { channel: unknown; date: unknown; amount: unknown };

  if (!isManualChannel(channel)) {
    return NextResponse.json({ error: "channel debe ser 'meta', 'google' o 'tiktok'" }, { status: 400 });
  }
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date debe tener formato YYYY-MM-DD" }, { status: 400 });
  }
  if (typeof amount !== "number" || amount < 0) {
    return NextResponse.json({ error: "amount debe ser un número >= 0" }, { status: 400 });
  }

  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO ads_spend (account_id, product_id, date, amount, channel) VALUES (?, NULL, ?, ?, ?)`,
    args: [account.id, date, amount, channel],
  });
  return NextResponse.json({ ok: true });
}
