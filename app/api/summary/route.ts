import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";

  const db = getDb();
  const groupBy = searchParams.get("groupBy");
  if (groupBy === "month") {
    const rows = db
      .prepare(
        `SELECT strftime('%Y-%m', o.date_created) as month, COALESCE(SUM(oi.net_profit), 0) as netProfit
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.date_created BETWEEN ? AND ?
         GROUP BY month ORDER BY month`
      )
      .all(from, to);
    return NextResponse.json(rows);
  }
  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(oi.unit_price * oi.quantity), 0) as grossSales,
         COALESCE(SUM(oi.ml_commission), 0) as totalCommission,
         COALESCE(SUM(oi.shipping_cost), 0) as totalShipping,
         COALESCE(SUM(oi.ads_cost_allocated), 0) as totalAds,
         COALESCE(SUM(oi.cost_applied * oi.quantity), 0) as totalCost,
         COALESCE(SUM(oi.net_profit), 0) as netProfit,
         SUM(CASE WHEN oi.cost_applied IS NULL THEN 1 ELSE 0 END) as itemsMissingCost
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.date_created BETWEEN ? AND ?`
    )
    .get(from, to);
  return NextResponse.json(totals);
}
