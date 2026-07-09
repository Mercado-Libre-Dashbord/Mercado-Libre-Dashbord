import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.sku, p.current_price as currentPrice, p.stock,
              (SELECT cost FROM product_costs pc WHERE pc.product_id = p.id ORDER BY pc.valid_from DESC LIMIT 1) as currentCost
       FROM products p ORDER BY p.title`
    )
    .all();
  return NextResponse.json(rows);
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
