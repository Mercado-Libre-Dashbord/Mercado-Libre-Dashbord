import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.sku, p.current_price as currentPrice, p.stock,
              (SELECT cost FROM product_costs pc WHERE pc.product_id = p.id ORDER BY pc.valid_from DESC LIMIT 1) as currentCost,
              (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                WHERE oi.product_id = p.id AND date(o.date_created) BETWEEN date(?) AND date(?)) as unitsSold,
              (SELECT COALESCE(SUM(oi.net_profit), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                WHERE oi.product_id = p.id AND date(o.date_created) BETWEEN date(?) AND date(?)) as totalProfit
       FROM products p ORDER BY p.title`
    )
    .all(from, to, from, to) as {
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
  const body = await request.json();
  const { productId, cost } = body as { productId: string; cost: number };
  if (!productId || typeof cost !== "number" || cost < 0) {
    return NextResponse.json({ error: "productId y cost (>= 0) son requeridos" }, { status: 400 });
  }
  const db = getDb();
  db.prepare(`INSERT INTO product_costs (product_id, cost, valid_from) VALUES (?, ?, ?)`).run(
    productId,
    cost,
    new Date().toISOString()
  );
  return NextResponse.json({ ok: true });
}
