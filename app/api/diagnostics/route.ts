import { NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { missingMigrations } from "@/db/schema-capabilities";
import { getCurrentUser, resolveCurrentAccount } from "@/lib/current-account";
import { getAdvertiserId } from "@/mcp/tools";

export const runtime = "nodejs";

/**
 * Estado real de los datos de una cuenta, para responder de una "¿por qué el
 * envío/IVA me da $0?" sin tener que leer logs ni adivinar. Solo admin: son
 * detalles de infraestructura, no algo que le sirva al vendedor.
 */
export async function GET() {
  const [account, user] = await Promise.all([resolveCurrentAccount(), getCurrentUser()]);
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!user?.isAdmin) return NextResponse.json({ error: "Solo para administradores" }, { status: 403 });

  const data = await withScope({ accountId: account.id }, async (client) => {
    const pending = await missingMigrations(client);

    const health = await client.query<Record<string, string>>(
      `SELECT
         COUNT(*) as "orderItems",
         SUM(CASE WHEN shipping_cost = 0 THEN 1 ELSE 0 END) as "sinEnvio",
         SUM(CASE WHEN cost_applied IS NULL THEN 1 ELSE 0 END) as "sinCosto",
         SUM(CASE WHEN ml_commission = 0 THEN 1 ELSE 0 END) as "sinComision"
       FROM order_items WHERE account_id = $1`,
      [account.id]
    );

    const ivaCount = pending.some((m) => m.column === "iva_applied")
      ? null
      : Number(
          (
            await client.query<{ n: string }>(
              `SELECT COUNT(*) as n FROM order_items WHERE account_id = $1 AND iva_applied IS NOT NULL AND iva_applied <> 0`,
              [account.id]
            )
          ).rows[0].n
        );

    const billingCount = pending.some((m) => m.table === "billing_charges")
      ? null
      : Number(
          (
            await client.query<{ n: string }>(`SELECT COUNT(*) as n FROM billing_charges WHERE account_id = $1`, [
              account.id,
            ])
          ).rows[0].n
        );

    // Publicidad: cuánto llegó a sincronizarse y si ML reconoce un advertiser
    // de Product Ads para esta cuenta. Sin esto, "los números de ads no dan"
    // era imposible de diagnosticar sin acceso directo a la base de otro
    // cliente: ahora lo puede ver cualquier admin desde el panel.
    let advertiserFound: boolean | null = null;
    let advertiserError: string | null = null;
    if (account.mlSellerId) {
      try {
        advertiserFound = (await getAdvertiserId(account.id)) !== null;
      } catch (err) {
        advertiserError = (err as Error).message;
      }
    }
    const adsResult = await client.query<{ n: string; total: string; min_date: string | null; max_date: string | null }>(
      `SELECT COUNT(*) as n, COALESCE(SUM(amount), 0) as total, MIN(date) as min_date, MAX(date) as max_date
         FROM ads_spend WHERE account_id = $1 AND channel = 'mercado_ads'`,
      [account.id]
    );
    const ads = adsResult.rows[0];

    const row = health.rows[0];
    return {
      account: { id: account.id, name: account.name, mlSellerId: account.mlSellerId },
      migracionesPendientes: pending.map((m) => ({ tabla: m.table, columna: m.column, sql: m.ddl })),
      datos: {
        lineasDeVenta: Number(row.orderItems ?? 0),
        conEnvioEnCero: Number(row.sinEnvio ?? 0),
        sinCostoCargado: Number(row.sinCosto ?? 0),
        conComisionEnCero: Number(row.sinComision ?? 0),
        conIvaCalculado: ivaCount,
        cargosDeFacturacion: billingCount,
        regimenFiscal: account.taxCondition,
        publicidad: {
          advertiserEncontrado: advertiserFound,
          errorAlBuscarAdvertiser: advertiserError,
          filasSincronizadas: Number(ads.n ?? 0),
          totalSincronizado: Number(ads.total ?? 0),
          desde: ads.min_date,
          hasta: ads.max_date,
        },
      },
      comoLeerlo: {
        regimenFiscal:
          "Si dice 'monotributo' o 'exento', el IVA no se calcula — es correcto, no un error.",
        publicidad:
          "Si advertiserEncontrado es false, ML dice que la cuenta nunca creó una campaña de Product Ads: no hay nada que sincronizar. Si es true y totalSincronizado es 0 (o 'desde'/'hasta' quedan muy viejos), la publicidad de los últimos ~90 días no se trajo — Mercado Ads solo sirve métricas de ese rango. Apretá 'Sincronizar' de nuevo para reintentarlo.",
        conEnvioEnCero:
          "Si es igual a lineasDeVenta, ninguna orden tiene el envío traído de la API. Apretá 'Sincronizar' en Resumen: recorre toda la historia y repara las órdenes que quedaron en una versión vieja del cálculo.",
        conIvaCalculado:
          "null = falta correr db/postgres/migrations/002-iva-y-facturacion.sql. 0 = la migración está pero todavía no recalculaste el historial.",
        cargosDeFacturacion:
          "null = falta la tabla billing_charges (misma migración). 0 = la API de facturación no devolvió cargos (permisos, o el período todavía no cerró).",
      },
    };
  });

  return NextResponse.json(data);
}
