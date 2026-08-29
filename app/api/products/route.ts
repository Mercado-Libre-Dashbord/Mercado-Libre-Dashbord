import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { resolveCurrentAccount } from "@/lib/current-account";
import { revenueStatusFilter } from "@/lib/order-status";
import { recalculateProduct } from "@/sync/sync-service";

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
    const thumbnailColumn = (await hasColumn(client, "products", "thumbnail")) ? "p.thumbnail" : "NULL::text";
    const result = await client.query(
      `SELECT p.id, p.title, p.sku, p.current_price as "currentPrice", p.stock,
              ${thumbnailColumn} as thumbnail,
              (SELECT cost FROM product_costs pc WHERE pc.account_id = p.account_id AND pc.product_id = p.id ORDER BY pc.valid_from DESC LIMIT 1) as "currentCost",
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
      thumbnail: string | null;
      currentCost: number | null;
      unitsSold: number;
      totalProfit: number;
    }[];

    // El margen descuenta la alícuota de otros impuestos de la CUENTA. Antes
    // salía de un impuesto cargado producto por producto, que ya no existe:
    // seguir leyéndolo mostraría márgenes calculados con datos viejos.
    return rows.map((r) => ({
      ...r,
      marginPct:
        r.currentCost !== null && r.currentPrice > 0
          ? (r.currentPrice * (1 - account.otherTaxRate) - r.currentCost) / r.currentPrice
          : null,
    }));
  });

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

  // Los impuestos ya no se guardan por producto: son una alícuota de la cuenta
  // (ver /api/account/settings). La columna `tax` queda con su default en 0.
  const itemsUpdated = await withScope({ accountId: account.id }, async (client) => {
    await client.query(
      `INSERT INTO product_costs (account_id, product_id, cost, valid_from) VALUES ($1, $2, $3, $4)`,
      [account.id, productId, cost, new Date().toISOString()]
    );

    // Y se aplica ya mismo a las ventas de ese producto. Antes el costo se
    // guardaba y nada más: había que correr un "Sincronizar" completo —que
    // recorre todo el historial contra la API de ML— para que el número del
    // panel cambiara. Mientras tanto el vendedor veía "N líneas sin costo
    // cargado" para productos que acababa de completar, y parecía que la
    // carga no había tomado.
    const hasIva = await hasColumn(client, "order_items", "iva_applied");
    return recalculateProduct(client, account.id, productId, hasIva, account.otherTaxRate);
  });

  return NextResponse.json({ ok: true, itemsUpdated });
}
