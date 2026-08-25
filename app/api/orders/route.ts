import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
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
  const groupBy = searchParams.get("groupBy");

  const rows = await withScope({ accountId: account.id }, async (client) => {
    if (groupBy === "order") {
      const result = await client.query(
        `SELECT o.id as "orderId", o.status as "estadoPago", o.date_created as "dateCreated",
                COALESCE(SUM(oi.unit_price * oi.quantity), 0) as "totalOrder",
                COALESCE(SUM(oi.net_profit), 0) as "totalNeto"
         FROM orders o JOIN order_items oi ON oi.account_id = o.account_id AND oi.order_id = o.id
         WHERE o.account_id = $1 AND o.date_created::date BETWEEN $2::date AND $3::date
         GROUP BY o.account_id, o.id
         ORDER BY o.date_created DESC
         LIMIT 20`,
        [account.id, from, to]
      );
      return result.rows;
    }

    const conditions = ["oi.account_id = $1", "o.date_created::date BETWEEN $2::date AND $3::date"];
    const args: unknown[] = [account.id, from, to];
    if (productId) {
      args.push(productId);
      conditions.push(`oi.product_id = $${args.length}`);
    }
    if (status) {
      args.push(status);
      conditions.push(`o.status = $${args.length}`);
    }

    const result = await client.query(
      `SELECT oi.id, o.id as "orderId", o.date_created as "dateCreated", oi.product_id as "productId",
              p.title as "productTitle", oi.unit_price as "unitPrice", oi.quantity,
              oi.ml_commission as "mlCommission", oi.shipping_cost as "shippingCost",
              oi.ads_cost_allocated as "adsCostAllocated", oi.cost_applied as "costApplied",
              oi.tax_applied as "taxApplied",
              oi.net_profit as "netProfit", o.status as "estadoPago",
              -- El costo aplicado puede venir de un registro cargado *después* de esta
              -- venta (fallback al costo más viejo conocido, ver getCostAtDate) — acá
              -- distinguimos ese caso para no mostrarlo igual que un costo real de la
              -- época, sin necesidad de guardar esa distinción en una columna aparte.
              (oi.cost_applied IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM product_costs pc
                 WHERE pc.account_id = oi.account_id AND pc.product_id = oi.product_id
                   AND pc.valid_from <= o.date_created
              )) as "costEstimated"
       FROM order_items oi
       JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
       JOIN products p ON p.account_id = oi.account_id AND p.id = oi.product_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY o.date_created DESC`,
      args
    );
    return result.rows;
  });

  return NextResponse.json(rows);
}
