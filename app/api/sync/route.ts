import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { runSync } from "@/sync/sync-service";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!account.mlSellerId) {
    return NextResponse.json(
      { error: "Esta cuenta todavía no conectó Mercado Libre. Andá a /api/ml/login para autorizar." },
      { status: 400 }
    );
  }

  // Un sync normal solo trae órdenes MÁS NUEVAS que la última guardada, así
  // que cualquier dato que venga del payload de la orden (el costo de envío,
  // por ejemplo) queda congelado para siempre en las ventas viejas. El sync
  // completo reprocesa todo el historial contra la API para rellenarlo.
  const body = await request.json().catch(() => ({}));
  const full = (body as { full?: boolean }).full === true;

  try {
    const result = await withScope({ accountId: account.id }, async (client) => {
      let sinceIso = "2020-01-01T00:00:00Z";
      if (!full) {
        const sinceResult = await client.query<{ latest: string | Date | null }>(
          `SELECT MAX(date_created) as latest FROM orders WHERE account_id = $1`,
          [account.id]
        );
        const latest = sinceResult.rows[0]?.latest ?? null;
        if (latest) sinceIso = new Date(latest).toISOString();
      }
      return runSync(client, account.id, account.mlSellerId!, sinceIso);
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
