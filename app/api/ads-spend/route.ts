import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";

export const runtime = "nodejs";

const MANUAL_CHANNELS = ["meta", "google", "tiktok"] as const;
type ManualChannel = (typeof MANUAL_CHANNELS)[number];

function isManualChannel(value: unknown): value is ManualChannel {
  return typeof value === "string" && (MANUAL_CHANNELS as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, date, amount, channel FROM ads_spend
       WHERE channel != 'mercado_ads' AND date BETWEEN ? AND ?
       ORDER BY date DESC`
    )
    .all(from, to);
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
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

  const db = getDb();
  db.prepare(`INSERT INTO ads_spend (product_id, date, amount, channel) VALUES (NULL, ?, ?, ?)`).run(
    date,
    amount,
    channel
  );
  return NextResponse.json({ ok: true });
}
