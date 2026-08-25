import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { syncProducts, syncOrders, syncAds, syncBillingCharges, recalculate, pendingOrderIds } from "@/sync/sync-service";
import { listOrdersPage } from "@/mcp/tools";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";
/** Techo del plan Hobby. Aun así el historial va por lotes: ver abajo. */
export const maxDuration = 60;

const HISTORY_START = "2020-01-01T00:00:00Z";

/**
 * Órdenes que mira cada llamada. Es una página entera de la API, pero solo se
 * le piden a Mercado Libre las que están desatrasadas (ver pendingOrderIds),
 * así que un lote sin novedades cuesta dos consultas y termina al instante.
 * Traer todo en un request se pasaba del límite de tiempo de la función y
 * Vercel lo mataba a mitad de camino.
 */
const ORDERS_PER_BATCH = 50;

interface SyncBody {
  /** Desde qué orden seguir. El cliente reenvía el que devolvimos. */
  offset?: number;
}

export async function POST(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!account.mlSellerId) {
    return NextResponse.json(
      { error: "Esta cuenta todavía no conectó Mercado Libre. Andá a /api/ml/login para autorizar." },
      { status: 400 }
    );
  }
  const sellerId = account.mlSellerId;

  const body = (await request.json().catch(() => ({}))) as SyncBody;
  const offset = Math.max(0, Number(body.offset ?? 0));

  try {
    const result = await withScope({ accountId: account.id }, async (client) => {
      const hasIva = await hasColumn(client, "order_items", "iva_applied");

      // El catálogo se sincroniza una sola vez, al arrancar.
      const productsSynced = offset === 0 ? await syncProducts(client, account.id, sellerId) : 0;

      const page = await listOrdersPage(account.id, sellerId, HISTORY_START, offset, ORDERS_PER_BATCH);
      const pending = await pendingOrderIds(client, account.id, page.ids);
      const ordersSynced = await syncOrders(client, account.id, pending, hasIva, account.otherTaxRate);

      const nextOffset = offset + page.ids.length;
      const done = page.ids.length === 0 || nextOffset >= page.total;

      // Publicidad, recálculo y facturación dependen de tener todas las
      // órdenes cargadas, así que van al final, en el último lote.
      let adsRowsSynced = 0;
      let billingChargesSynced = 0;
      if (done) {
        adsRowsSynced = await syncAds(client, account.id, sellerId, HISTORY_START);
        await recalculate(client, account.id, hasIva, account.otherTaxRate);
        billingChargesSynced = await syncBillingCharges(client, account.id);
      }

      return {
        done,
        offset: nextOffset,
        totalOrders: page.total,
        productsSynced,
        ordersSynced,
        adsRowsSynced,
        billingChargesSynced,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
