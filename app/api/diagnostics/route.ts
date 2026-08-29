import { NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { missingMigrations } from "@/db/schema-capabilities";
import { getCurrentUser, resolveCurrentAccount } from "@/lib/current-account";

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
      },
      comoLeerlo: {
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
