import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { syncProductsPage, syncOrders, syncAds, syncFullStock, syncBillingCharges, recalculate, pendingOrderIds, backfillMissingProducts } from "@/sync/sync-service";
import { appliesIva } from "@/db/accounts";
import { listOrdersPage } from "@/mcp/tools";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";
/** Techo del plan Hobby. Aun así el historial va por lotes: ver abajo. */
export const maxDuration = 60;

const HISTORY_START_DATE = "2020-01-01";

/**
 * Órdenes que mira cada llamada. Es una página entera de la API, pero solo se
 * le piden a Mercado Libre las que están desatrasadas (ver pendingOrderIds),
 * así que un lote sin novedades cuesta dos consultas y termina al instante.
 * Traer todo en un request se pasaba del límite de tiempo de la función y
 * Vercel lo mataba a mitad de camino.
 */
const ORDERS_PER_BATCH = 50;

/**
 * Cuánto tiempo como máximo se le dedica a escanear catálogo en una sola
 * llamada, antes de cortar y seguir en la próxima. Deja margen bajo el techo
 * de 60s de la función (autenticación, conexión a la base, armar la
 * respuesta): una cuenta con decenas de miles de publicaciones no entra en
 * una sola pasada, y sin este corte Vercel mataba la función a mitad de
 * camino — el sync se caía entero en vez de simplemente tardar un poco más.
 */
const PRODUCTS_TIME_BUDGET_MS = 35_000;

interface SyncBody {
  /** scroll_id de catálogo para retomar el escaneo donde quedó. */
  productsScrollId?: string;
  /** Si el catálogo ya quedó sincronizado del todo (en esta corrida). */
  productsDone?: boolean;
  /** Desde qué fecha seguir con las órdenes (ver `listOrdersPage`). */
  ordersFrom?: string;
  /** Desde qué orden, dentro de esa ventana, seguir. */
  ordersOffsetInWindow?: number;
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
  const productsDone = body.productsDone === true;
  const ordersFrom = body.ordersFrom ?? HISTORY_START_DATE;
  const offsetInWindow = Math.max(0, Number(body.ordersOffsetInWindow ?? 0));
  const ordersStarted = body.ordersFrom !== undefined || offsetInWindow > 0;

  try {
    const result = await withScope({ accountId: account.id }, async (client) => {
      const hasIva = await hasColumn(client, "order_items", "iva_applied");

      const ordersPhase = async (productsSynced: number, from: string, offset: number) => {
        const today = new Date().toISOString().slice(0, 10);
        const page = await listOrdersPage(account.id, sellerId, from, today, offset, ORDERS_PER_BATCH);
        const pending = await pendingOrderIds(client, account.id, page.ids);
        const ordersSynced = await syncOrders(client, account.id, pending, hasIva, account.otherTaxRate, appliesIva(account.taxCondition));

        const done = page.done;

        // Publicidad, recálculo y facturación dependen de tener todas las
        // órdenes cargadas, así que van al final, en el último lote.
        let adsRowsSynced = 0;
        let billingChargesSynced = 0;
        let fullStockSynced = 0;
        if (done) {
          adsRowsSynced = await syncAds(client, account.id, sellerId, `${HISTORY_START_DATE}T00:00:00Z`);
          // Antes del recálculo: le da nombre y foto a las publicaciones dadas
          // de baja que se vendieron, así aparecen en Productos y se les puede
          // cargar el costo.
          await backfillMissingProducts(client, account.id, sellerId);
          // Depende del catálogo ya sincronizado (necesita el inventory_id de
          // cada producto), no de las órdenes — puede ir en cualquier momento
          // del último lote.
          fullStockSynced = await syncFullStock(client, account.id);
          await recalculate(client, account.id, hasIva, account.otherTaxRate, appliesIva(account.taxCondition));
          billingChargesSynced = await syncBillingCharges(client, account.id);
        }

        return {
          done,
          productsSynced,
          ordersSynced,
          adsRowsSynced,
          billingChargesSynced,
          fullStockSynced,
          productsDone: true,
          ordersFrom: page.nextFrom,
          ordersOffsetInWindow: page.nextOffsetInWindow,
        };
      };

      // El catálogo se sincroniza una sola vez, al arrancar — pero uno
      // grande (decenas de miles de publicaciones) no entra en el tiempo de
      // una sola función. Se escanea por páginas de scroll hasta terminar,
      // cortando y devolviendo `nextScrollId` si hace falta más de una
      // llamada; si el catálogo entero entró en esta misma pasada, sigue
      // derecho con las órdenes en vez de gastar una ida y vuelta solo para
      // avisar que ya terminó.
      if (!ordersStarted && !productsDone) {
        const deadline = Date.now() + PRODUCTS_TIME_BUDGET_MS;
        const { productsSynced, nextScrollId } = await syncProductsPage(
          client, account.id, sellerId, body.productsScrollId, deadline
        );
        if (nextScrollId) {
          return {
            done: false,
            productsSynced,
            ordersSynced: 0,
            adsRowsSynced: 0,
            billingChargesSynced: 0,
            fullStockSynced: 0,
            productsScrollId: nextScrollId,
            productsDone: false,
          };
        }
        return ordersPhase(productsSynced, HISTORY_START_DATE, 0);
      }

      return ordersPhase(0, ordersFrom, offsetInWindow);
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
