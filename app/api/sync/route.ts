import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { runSync, syncProducts, syncOrders, syncAds, syncBillingCharges, recalculate } from "@/sync/sync-service";
import { listOrdersPage } from "@/mcp/tools";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";
/** Techo del plan Hobby. Aun así el historial va por lotes: ver abajo. */
export const maxDuration = 60;

const FULL_SYNC_START = "2020-01-01T00:00:00Z";
/**
 * Cuántas órdenes procesa cada llamada del recálculo del historial.
 * Cada orden cuesta ~2 llamadas a la API de Mercado Libre, así que un
 * historial entero en un solo request se pasa del límite de la función y
 * Vercel lo mata a mitad de camino (que es exactamente lo que estaba
 * pasando: el request moría sin escribir nada y el envío seguía en $0).
 */
const ORDERS_PER_BATCH = 10;

interface SyncBody {
  full?: boolean;
  /** Desde qué orden seguir, dentro del recálculo del historial. */
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

  try {
    // Sync incremental: son pocas órdenes nuevas, entra cómodo en un request.
    if (!body.full) {
      const result = await withScope({ accountId: account.id }, async (client) => {
        const sinceResult = await client.query<{ latest: string | Date | null }>(
          `SELECT MAX(date_created) as latest FROM orders WHERE account_id = $1`,
          [account.id]
        );
        const latest = sinceResult.rows[0]?.latest ?? null;
        const sinceIso = latest ? new Date(latest).toISOString() : FULL_SYNC_START;
        return runSync(client, account.id, sellerId, sinceIso);
      });
      return NextResponse.json({ ...result, done: true });
    }

    // Recálculo del historial, por lotes. El cliente vuelve a llamar con el
    // offset que devolvemos hasta recibir done: true.
    const offset = Math.max(0, Number(body.offset ?? 0));

    const result = await withScope({ accountId: account.id }, async (client) => {
      const hasIva = await hasColumn(client, "order_items", "iva_applied");

      // El catálogo se sincroniza una sola vez, al arrancar.
      const productsSynced = offset === 0 ? await syncProducts(client, account.id, sellerId) : 0;

      const page = await listOrdersPage(account.id, sellerId, FULL_SYNC_START, offset, ORDERS_PER_BATCH);
      const ordersSynced = await syncOrders(client, account.id, page.ids, hasIva);
      const nextOffset = offset + page.ids.length;
      const done = page.ids.length === 0 || nextOffset >= page.total;

      // Publicidad, recálculo y facturación dependen de tener todas las
      // órdenes cargadas, así que van al final, en el último lote.
      let adsRowsSynced = 0;
      let billingChargesSynced = 0;
      if (done) {
        adsRowsSynced = await syncAds(client, account.id, sellerId, FULL_SYNC_START);
        await recalculate(client, account.id, hasIva);
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
