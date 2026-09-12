import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { syncProductsPage, syncOrders, syncAds, syncFullStock, syncBillingCharges, recalculate, pendingOrderIds, backfillMissingProducts } from "@/sync/sync-service";
import { appliesIva, setOrdersSyncedThrough } from "@/db/accounts";
import { listOrdersPage } from "@/mcp/tools";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";
/** Techo del plan Hobby. Aun así el historial va por lotes: ver abajo. */
export const maxDuration = 60;

const HISTORY_START_DATE = "2020-01-01";

/**
 * Cuando una cuenta ya completó un sync entero (`orders_synced_through`
 * guardado, ver migración 018), el próximo sync arranca acá atrás en vez de
 * desde el arranque del historial — margen para agarrar altas o cambios de
 * estado tardíos en órdenes recientes, sin tener que recorrer años enteros
 * que `pendingOrderIds` va a descartar de todos modos porque ya están al día
 * (esa función no vuelve a comparar el estado contra ML, solo mira si el
 * código con el que se procesaron cambió).
 */
const ORDERS_INCREMENTAL_LOOKBACK_DAYS = 30;

function addDaysStr(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}

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
  /** Pide correr el cierre (ads, stock de Full, recálculo, facturación) en esta llamada. */
  finalize?: boolean;
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
  const finalize = body.finalize === true;
  const productsDone = body.productsDone === true;
  // Arranque de un sync nuevo (no la continuación de un lote en curso): usar
  // el checkpoint de la cuenta si ya completó una vuelta entera alguna vez.
  const freshOrdersFrom = account.ordersSyncedThrough
    ? addDaysStr(account.ordersSyncedThrough, -ORDERS_INCREMENTAL_LOOKBACK_DAYS)
    : HISTORY_START_DATE;
  const ordersFrom = body.ordersFrom ?? (freshOrdersFrom > HISTORY_START_DATE ? freshOrdersFrom : HISTORY_START_DATE);
  const offsetInWindow = Math.max(0, Number(body.ordersOffsetInWindow ?? 0));
  const ordersStarted = body.ordersFrom !== undefined || offsetInWindow > 0;

  try {
    const result = await withScope({ accountId: account.id }, async (client) => {
      const hasIva = await hasColumn(client, "order_items", "iva_applied");

      // Publicidad, recálculo y facturación dependen de tener todas las
      // órdenes cargadas, así que van al final — pero en su PROPIA llamada,
      // con su propio presupuesto de 60s. Antes compartían la llamada con el
      // último lote de órdenes: para una cuenta con mucho volumen (catálogo
      // grande en Full, muchos años de Ads) esa combinación ocasionalmente se
      // pasaba del techo de tiempo (pasó en producción), justo cuando ya no
      // quedaba nada más por sincronizar.
      const finalizePhase = async () => {
        const today = new Date().toISOString().slice(0, 10);
        const adsRowsSynced = await syncAds(client, account.id, sellerId, `${HISTORY_START_DATE}T00:00:00Z`);
        // Antes del recálculo: le da nombre y foto a las publicaciones dadas
        // de baja que se vendieron, así aparecen en Productos y se les puede
        // cargar el costo.
        await backfillMissingProducts(client, account.id, sellerId);
        // Depende del catálogo ya sincronizado (necesita el inventory_id de
        // cada producto), no de las órdenes.
        const fullStockSynced = await syncFullStock(client, account.id);
        await recalculate(client, account.id, hasIva, account.otherTaxRate, appliesIva(account.taxCondition));
        const billingChargesSynced = await syncBillingCharges(client, account.id);
        // Recién ahora queda confirmado que todo el historial hasta hoy está
        // al día: el próximo sync puede arrancar cerca de acá en vez de
        // desde cero.
        await setOrdersSyncedThrough(client, account.id, today);

        return {
          done: true,
          productsSynced: 0,
          ordersSynced: 0,
          adsRowsSynced,
          billingChargesSynced,
          fullStockSynced,
          productsDone: true,
          finalized: true,
        };
      };

      if (finalize) return finalizePhase();

      const ordersPhase = async (productsSynced: number, from: string, offset: number) => {
        const today = new Date().toISOString().slice(0, 10);
        const page = await listOrdersPage(account.id, sellerId, from, today, offset, ORDERS_PER_BATCH);
        const pending = await pendingOrderIds(client, account.id, page.ids);
        const ordersSynced = await syncOrders(client, account.id, pending, hasIva, account.otherTaxRate, appliesIva(account.taxCondition));

        return {
          done: page.done,
          productsSynced,
          ordersSynced,
          adsRowsSynced: 0,
          billingChargesSynced: 0,
          fullStockSynced: 0,
          productsDone: true,
          ordersFrom: page.nextFrom,
          ordersOffsetInWindow: page.nextOffsetInWindow,
          // Todavía falta el cierre: el cliente tiene que pedirlo aparte.
          finalized: page.done ? false : undefined,
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
        return ordersPhase(productsSynced, ordersFrom, 0);
      }

      return ordersPhase(0, ordersFrom, offsetInWindow);
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
