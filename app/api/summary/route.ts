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
         WHERE date(o.date_created) BETWEEN date(?) AND date(?)
         GROUP BY month ORDER BY month`
      )
      .all(from, to);
    return NextResponse.json(rows);
  }

  const totals = db
    .prepare(
      `SELECT
         COUNT(DISTINCT o.id) as orders,
         COALESCE(SUM(oi.unit_price * oi.quantity), 0) as grossSales,
         COALESCE(SUM(oi.ml_commission), 0) as totalCommission,
         COALESCE(SUM(oi.shipping_cost), 0) as totalShipping,
         COALESCE(SUM(oi.ads_cost_allocated), 0) as totalMercadoAds,
         COALESCE(SUM(oi.cost_applied * oi.quantity), 0) as totalCost,
         COALESCE(SUM(oi.net_profit), 0) as netProfit,
         SUM(CASE WHEN oi.cost_applied IS NULL THEN 1 ELSE 0 END) as itemsMissingCost,
         COUNT(DISTINCT CASE WHEN oi.cost_applied IS NOT NULL THEN o.id END) as ordersWithCost
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE date(o.date_created) BETWEEN date(?) AND date(?)`
    )
    .get(from, to) as any;

  const manualAdsRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM ads_spend
       WHERE channel != 'mercado_ads' AND date BETWEEN ? AND ?`
    )
    .get(from, to) as { total: number };

  const adSpend = totals.totalMercadoAds + manualAdsRow.total;
  const revenue = totals.grossSales;
  const orders = totals.orders;
  const netProfit = totals.netProfit;

  return NextResponse.json({
    orders,
    grossSales: revenue,
    aov: orders > 0 ? revenue / orders : 0,
    netProfit,
    profitPct: revenue > 0 ? netProfit / revenue : 0,
    netRevenue: revenue - totals.totalCommission - totals.totalShipping,
    totalCommission: totals.totalCommission,
    totalShipping: totals.totalShipping,
    totalCost: totals.totalCost,
    adSpend,
    mer: adSpend > 0 ? revenue / adSpend : 0,
    roas: adSpend > 0 ? revenue / adSpend : 0,
    cpa: orders > 0 ? adSpend / orders : 0,
    netAov: orders > 0 ? netProfit / orders : 0,
    trueCpa: totals.ordersWithCost > 0 ? adSpend / totals.ordersWithCost : 0,
    itemsMissingCost: totals.itemsMissingCost,
  });
}
