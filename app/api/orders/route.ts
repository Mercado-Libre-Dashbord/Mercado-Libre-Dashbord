import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";
  const productId = searchParams.get("productId");
  const status = searchParams.get("status");

  const db = getDb();
  const groupBy = searchParams.get("groupBy");
  if (groupBy === "order") {
    const rows = db
      .prepare(
        `SELECT o.id as orderId, o.status as estadoPago, o.date_created as dateCreated,
                COALESCE(SUM(oi.unit_price * oi.quantity), 0) as totalOrder,
                COALESCE(SUM(oi.net_profit), 0) as totalNeto
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE date(o.date_created) BETWEEN date(?) AND date(?)
         GROUP BY o.id
         ORDER BY o.date_created DESC
         LIMIT 20`
      )
      .all(from, to);
    return NextResponse.json(rows);
  }
  const query = `
    SELECT oi.id, o.id as orderId, o.date_created as dateCreated, oi.product_id as productId,
           p.title as productTitle, oi.unit_price as unitPrice, oi.quantity,
           oi.ml_commission as mlCommission, oi.shipping_cost as shippingCost,
           oi.ads_cost_allocated as adsCostAllocated, oi.cost_applied as costApplied,
           oi.net_profit as netProfit, o.status as estadoPago
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE date(o.date_created) BETWEEN date(?) AND date(?)
      ${productId ? "AND oi.product_id = ?" : ""}
      ${status ? "AND o.status = ?" : ""}
    ORDER BY o.date_created DESC
  `;
  const params = [from, to, ...(productId ? [productId] : []), ...(status ? [status] : [])];
  const rows = db.prepare(query).all(...params);
  return NextResponse.json(rows);
}
