import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT p.id, p.title, p.sku, p.current_price as currentPrice, p.stock,
            (SELECT cost FROM product_costs pc WHERE pc.account_id = p.account_id AND pc.product_id = p.id ORDER BY pc.valid_from DESC LIMIT 1) as currentCost,
            (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
              WHERE oi.account_id = p.account_id AND oi.product_id = p.id AND date(o.date_created) BETWEEN date(?) AND date(?)) as unitsSold,
            (SELECT COALESCE(SUM(oi.net_profit), 0) FROM order_items oi JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
              WHERE oi.account_id = p.account_id AND oi.product_id = p.id AND date(o.date_created) BETWEEN date(?) AND date(?)) as totalProfit
         FROM products p WHERE p.account_id = ? ORDER BY p.title`,
    args: [from, to, from, to, account.id],
  });

  const rows = result.rows as unknown as {
    id: string;
    title: string;
    sku: string | null;
    currentPrice: number;
    stock: number;
    currentCost: number | null;
    unitsSold: number;
    totalProfit: number;
  }[];

  const withMargin = rows.map((r) => ({
    ...r,
    marginPct:
      r.currentCost !== null && r.currentPrice > 0 ? (r.currentPrice - r.currentCost) / r.currentPrice : null,
  }));

  return NextResponse.json(withMargin);
}

export async function PATCH(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { productId, cost } = body as { productId: string; cost: number };
  if (!productId || typeof cost !== "number" || cost < 0) {
    return NextResponse.json({ error: "productId y cost (>= 0) son requeridos" }, { status: 400 });
  }
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO product_costs (account_id, product_id, cost, valid_from) VALUES (?, ?, ?, ?)`,
    args: [account.id, productId, cost, new Date().toISOString()],
  });
  return NextResponse.json({ ok: true });
}
