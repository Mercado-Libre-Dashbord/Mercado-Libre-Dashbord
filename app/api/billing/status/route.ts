import { NextResponse } from "next/server";
import { resolveCurrentAccount } from "@/lib/current-account";
import { listBillingPeriods, probeAccountRestrictions } from "@/mcp/tools";
import { billingHealth } from "@/lib/billing-alerts";

export const runtime = "nodejs";

/**
 * "Facturas vencidas": lo único que la API de facturación de ML confirma es
 * si un período está OPEN (todavía sumando cargos) o CLOSED (cerrado) y su
 * monto — no si está pagado. Para eso se suma una sonda de
 * /users/{id}/restrictions, un endpoint que apareció en una investigación
 * externa sin confirmar oficialmente: si devuelve algo reconocible (un
 * array, aunque sea vacío) se interpreta como "sin restricciones activas";
 * si falla o no da nada usable, se dice explícitamente que no se pudo
 * confirmar en vez de asumir que está todo bien.
 */
export async function GET() {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!account.mlSellerId) {
    return NextResponse.json({ error: "Esta cuenta todavía no conectó Mercado Libre." }, { status: 400 });
  }

  const [periods, restrictions] = await Promise.all([
    listBillingPeriods(account.id).catch(() => []),
    probeAccountRestrictions(account.id, account.mlSellerId).catch((err) => ({
      ok: false as const,
      error: (err as Error).message,
    })),
  ]);

  // Un array vacío es una respuesta reconocible (0 restricciones activas);
  // cualquier otra forma es "no sabemos leer esto todavía".
  const restrictionsConfirmed = restrictions.ok && restrictions.isArray;
  const activeRestrictions = restrictionsConfirmed ? (restrictions as any).length : null;

  const recent = periods.slice(0, 6);
  // El estado de cada factura y cuánta plata hay en cada uno, calculado sobre
  // la fecha de hoy del servidor: si se hiciera en el navegador, el reloj del
  // cliente decidiría si una factura está vencida.
  const health = billingHealth(recent, new Date().toISOString().slice(0, 10));

  return NextResponse.json({
    periods: recent.map((p) => ({
      key: p.key,
      dateFrom: p.dateFrom,
      dateTo: p.dateTo,
      amount: p.amount,
      periodStatus: p.periodStatus,
      dueDate: p.dueDate,
      paid: p.paid,
    })),
    health,
    restrictions: {
      confirmed: restrictionsConfirmed,
      activeRestrictions,
      raw: restrictions,
    },
  });
}
