import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { resolveCurrentAccount } from "@/lib/current-account";
import { revenueStatusFilter } from "@/lib/order-status";
import { buildOrderReceipt, type OrderReceipt } from "@/lib/order-receipt";

export const runtime = "nodejs";

const MAX_ROWS = 200;

interface OrderRow {
  orderId: string;
  date: string;
  revenue: string | number;
  mlCommission: string | number;
  shippingCost: string | number;
  adsCost: string | number;
  productCost: string | number;
  otherTax: string | number;
  iva: string | number;
  itemsMissingCost: string | number;
  realMlCharges: string | number | null;
}

/**
 * Rentabilidad real venta por venta: el recibo de cada orden.
 *
 * La página de Productos contesta "qué producto deja plata"; esto contesta
 * "qué pasó en esta venta", que es otra pregunta. Dos ventas del mismo
 * producto pueden dejar márgenes muy distintos según si el envío lo absorbió
 * el vendedor y cuánta publicidad se le imputó ese día.
 *
 * La comisión y el envío salen de lo que ML informó orden por orden. Cuando
 * además ya está sincronizada la factura del período, se cruza contra lo que
 * ML efectivamente cobró (`billing_charges.order_id`) y se muestra la
 * diferencia: es la única forma de detectar que a una orden le cobraron algo
 * que no estaba en la estimación.
 */
export async function GET(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";
  // "Solo las que pierden plata" es la vista que de verdad se usa: son las
  // que hay que arreglar, y mezcladas entre cientos de órdenes sanas no se
  // encuentran.
  const onlyNegative = searchParams.get("filter") === "negativo";

  const receipts = await withScope({ accountId: account.id }, async (client) => {
    const taxSum = (await hasColumn(client, "order_items", "tax_applied"))
      ? "COALESCE(SUM(oi.tax_applied * oi.quantity), 0)"
      : "0::double precision";
    const ivaSum = (await hasColumn(client, "order_items", "iva_applied"))
      ? "COALESCE(SUM(oi.iva_applied), 0)"
      : "0::double precision";
    // La tabla de cargos llega por migración manual; sin ella el recibo se
    // arma igual, solo que sin la columna de conciliación.
    const hasCharges = await hasColumn(client, "billing_charges", "detail_id");
    const realCharges = hasCharges
      ? `(SELECT SUM(bc.amount) FROM billing_charges bc
           WHERE bc.account_id = oi.account_id AND bc.order_id = o.id)`
      : "NULL::double precision";

    const result = await client.query<OrderRow>(
      `SELECT o.id as "orderId",
              to_char(o.date_created, 'YYYY-MM-DD') as date,
              COALESCE(SUM(oi.unit_price * oi.quantity), 0) as revenue,
              COALESCE(SUM(oi.ml_commission), 0) as "mlCommission",
              COALESCE(SUM(oi.shipping_cost), 0) as "shippingCost",
              COALESCE(SUM(oi.ads_cost_allocated), 0) as "adsCost",
              COALESCE(SUM(oi.cost_applied * oi.quantity), 0) as "productCost",
              ${taxSum} as "otherTax",
              ${ivaSum} as iva,
              SUM(CASE WHEN oi.cost_applied IS NULL THEN 1 ELSE 0 END) as "itemsMissingCost",
              ${realCharges} as "realMlCharges"
         FROM order_items oi
         JOIN orders o ON o.account_id = oi.account_id AND o.id = oi.order_id
        WHERE oi.account_id = $1 AND o.date_created::date BETWEEN $2::date AND $3::date
          AND ${revenueStatusFilter()}
        GROUP BY o.id, o.date_created, oi.account_id
        ORDER BY o.date_created DESC
        LIMIT ${MAX_ROWS}`,
      [account.id, from, to]
    );

    return result.rows.map((r) =>
      buildOrderReceipt({
        orderId: r.orderId,
        date: r.date,
        revenue: Number(r.revenue),
        mlCommission: Number(r.mlCommission),
        shippingCost: Number(r.shippingCost),
        adsCost: Number(r.adsCost),
        productCost: Number(r.productCost),
        otherTax: Number(r.otherTax),
        iva: Number(r.iva),
        costMissing: Number(r.itemsMissingCost) > 0,
        // Los cargos de ML son negativos en la factura (es plata que sale);
        // acá se comparan contra un costo estimado, que es positivo.
        realMlCharges: r.realMlCharges === null ? null : Math.abs(Number(r.realMlCharges)),
      })
    );
  });

  const negatives = receipts.filter((r: OrderReceipt) => r.warning === "margen_negativo");

  return NextResponse.json({
    receipts: onlyNegative ? negatives : receipts,
    // Siempre sobre el total, no sobre lo filtrado: si contara solo lo que se
    // está mirando, el aviso desaparecería justo al filtrar por otra cosa.
    negativeCount: negatives.length,
    negativeAmount: negatives.reduce((sum: number, r: OrderReceipt) => sum + (r.netMargin ?? 0), 0),
    truncated: receipts.length >= MAX_ROWS,
  });
}
