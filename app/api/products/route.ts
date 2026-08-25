import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { resolveCurrentAccount } from "@/lib/current-account";
import { revenueStatusFilter } from "@/lib/order-status";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";

  const withMargin = await withScope({ accountId: account.id }, async (client) => {
    // Si todavía no se corrió la migración de impuestos, se devuelve null en
    // vez de romper toda la página (ver db/schema-capabilities.ts).
    const taxColumn = (await hasColumn(client, "product_costs", "tax"))
      ? `(SELECT tax FROM product_costs pc WHERE pc.account_id = p.account_id AND pc.product_id = p.id ORDER BY pc.valid_from DESC LIMIT 1)`
      : `NULL::double precision`;

    const result = await client.query(
      `SELECT p.id, p.title, p.sku, p.current_price as "currentPrice", p.stock,
              (SELECT cost FROM product_costs pc WHERE pc.account_id = p.account_id AND pc.product_id = p.id ORDER BY pc.valid_from DESC LIMIT 1) as "currentCost",
              ${taxColumn} as "currentTax",
              (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
                WHERE oi.account_id = p.account_id AND oi.product_id = p.id AND o.date_created::date BETWEEN $1::date AND $2::date
                  AND ${revenueStatusFilter()}) as "unitsSold",
              (SELECT COALESCE(SUM(oi.net_profit), 0) FROM order_items oi JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
                WHERE oi.account_id = p.account_id AND oi.product_id = p.id AND o.date_created::date BETWEEN $1::date AND $2::date
                  AND ${revenueStatusFilter()}) as "totalProfit"
         FROM products p WHERE p.account_id = $3 ORDER BY p.title`,
      [from, to, account.id]
    );

    const rows = result.rows as {
      id: string;
      title: string;
      sku: string | null;
      currentPrice: number;
      stock: number;
      currentCost: number | null;
      currentTax: number | null;
      unitsSold: number;
      totalProfit: number;
    }[];

    return rows.map((r) => ({
      ...r,
      marginPct:
        r.currentCost !== null && r.currentPrice > 0
          ? (r.currentPrice - r.currentCost - (r.currentTax ?? 0)) / r.currentPrice
          : null,
    }));
  });

  return NextResponse.json(withMargin);
}

export async function PATCH(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { productId, cost, tax } = body as { productId: string; cost: number; tax?: number };
  const taxValue = tax ?? 0;
  if (!productId || typeof cost !== "number" || cost < 0 || typeof taxValue !== "number" || taxValue < 0) {
    return NextResponse.json({ error: "productId, cost (>= 0) y tax (>= 0, opcional) son requeridos" }, { status: 400 });
  }

  await withScope({ accountId: account.id }, async (client) => {
    // Sin la columna `tax` se guarda igual el costo — perder el impuesto es
    // mucho mejor que rechazar la carga entera del costo.
    if (await hasColumn(client, "product_costs", "tax")) {
      return client.query(
        `INSERT INTO product_costs (account_id, product_id, cost, tax, valid_from) VALUES ($1, $2, $3, $4, $5)`,
        [account.id, productId, cost, taxValue, new Date().toISOString()]
      );
    }
    return client.query(
      `INSERT INTO product_costs (account_id, product_id, cost, valid_from) VALUES ($1, $2, $3, $4)`,
      [account.id, productId, cost, new Date().toISOString()]
    );
  });
  return NextResponse.json({ ok: true });
}
