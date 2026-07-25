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
  const productId = searchParams.get("productId");
  const status = searchParams.get("status");

  const db = await getDb();
  const groupBy = searchParams.get("groupBy");
  if (groupBy === "order") {
    const result = await db.execute({
      sql: `SELECT o.id as orderId, o.status as estadoPago, o.date_created as dateCreated,
              COALESCE(SUM(oi.unit_price * oi.quantity), 0) as totalOrder,
              COALESCE(SUM(oi.net_profit), 0) as totalNeto
            FROM orders o JOIN order_items oi ON oi.account_id = o.account_id AND oi.order_id = o.id
            WHERE o.account_id = ? AND date(o.date_created) BETWEEN date(?) AND date(?)
            GROUP BY o.id
            ORDER BY o.date_created DESC
            LIMIT 20`,
      args: [account.id, from, to],
    });
    return NextResponse.json(result.rows);
  }

  const query = `
    SELECT oi.id, o.id as orderId, o.date_created as dateCreated, oi.product_id as productId,
           p.title as productTitle, oi.unit_price as unitPrice, oi.quantity,
           oi.ml_commission as mlCommission, oi.shipping_cost as shippingCost,
           oi.ads_cost_allocated as adsCostAllocated, oi.cost_applied as costApplied,
           oi.net_profit as netProfit, o.status as estadoPago
    FROM order_items oi
    JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
    JOIN products p ON p.account_id = oi.account_id AND p.id = oi.product_id
    WHERE oi.account_id = ? AND date(o.date_created) BETWEEN date(?) AND date(?)
      ${productId ? "AND oi.product_id = ?" : ""}
      ${status ? "AND o.status = ?" : ""}
    ORDER BY o.date_created DESC
  `;
  const args = [account.id, from, to, ...(productId ? [productId] : []), ...(status ? [status] : [])];
  const result = await db.execute({ sql: query, args });
  return NextResponse.json(result.rows);
}
