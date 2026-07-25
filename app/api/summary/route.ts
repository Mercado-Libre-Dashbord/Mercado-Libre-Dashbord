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

  const groupBy = searchParams.get("groupBy");
  if (groupBy === "month") {
    const result = await db.execute({
      sql: `SELECT strftime('%Y-%m', o.date_created) as month, COALESCE(SUM(oi.net_profit), 0) as netProfit
            FROM order_items oi JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
            WHERE oi.account_id = ? AND date(o.date_created) BETWEEN date(?) AND date(?)
            GROUP BY month ORDER BY month`,
      args: [account.id, from, to],
    });
    return NextResponse.json(result.rows);
  }

  const totalsResult = await db.execute({
    sql: `SELECT
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
          JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
          WHERE oi.account_id = ? AND date(o.date_created) BETWEEN date(?) AND date(?)`,
    args: [account.id, from, to],
  });
  const totals = totalsResult.rows[0] as any;

  const manualAdsResult = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) as total FROM ads_spend
          WHERE account_id = ? AND channel != 'mercado_ads' AND date BETWEEN ? AND ?`,
    args: [account.id, from, to],
  });
  const manualAdsTotal = Number((manualAdsResult.rows[0] as any).total);

  const adSpend = Number(totals.totalMercadoAds) + manualAdsTotal;
  const revenue = Number(totals.grossSales);
  const orders = Number(totals.orders);
  const netProfit = Number(totals.netProfit);
  const ordersWithCost = Number(totals.ordersWithCost);

  return NextResponse.json({
    orders,
    grossSales: revenue,
    aov: orders > 0 ? revenue / orders : 0,
    netProfit,
    profitPct: revenue > 0 ? netProfit / revenue : 0,
    netRevenue: revenue - Number(totals.totalCommission) - Number(totals.totalShipping),
    totalCommission: Number(totals.totalCommission),
    totalShipping: Number(totals.totalShipping),
    totalCost: Number(totals.totalCost),
    adSpend,
    mer: adSpend > 0 ? revenue / adSpend : 0,
    roas: adSpend > 0 ? revenue / adSpend : 0,
    cpa: orders > 0 ? adSpend / orders : 0,
    netAov: orders > 0 ? netProfit / orders : 0,
    trueCpa: ordersWithCost > 0 ? adSpend / ordersWithCost : 0,
    itemsMissingCost: Number(totals.itemsMissingCost),
  });
}
