import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { resolveCurrentAccount } from "@/lib/current-account";
import { adChannelLabel, isManualAdChannel } from "@/lib/ad-channels";

export const runtime = "nodejs";

/**
 * Gasto en publicidad abierto por plataforma.
 *
 * Las tarjetas de Campañas muestran un Ad Spend solo: útil para saber cuánto
 * se gastó, inútil para decidir dónde recortar. Este desglose contesta la
 * otra pregunta — qué parte se fue a cada canal — y de paso deja ver cuánto
 * de Mercado Ads pudo atribuirse a una venta puntual y cuánto no.
 *
 * Solo reparte el gasto, no los ingresos: Mercado Libre no dice qué venta
 * vino de qué anuncio, así que un ROAS por canal sería inventado. Se muestra
 * el % del total invertido, que sí es un dato real.
 */
async function spendByChannel(accountId: string, from: string, to: string) {
  return withScope({ accountId }, async (client) => {
    const result = await client.query<{ channel: string; amount: string | number; attributed: boolean }>(
      `SELECT channel,
              COALESCE(SUM(amount), 0) as amount,
              -- Mercado Ads es el único canal que a veces llega atado a un
              -- producto; el resto se carga siempre a nivel cuenta.
              bool_or(product_id IS NOT NULL) as attributed
         FROM ads_spend
        WHERE account_id = $1 AND date BETWEEN $2::date AND $3::date
        GROUP BY channel`,
      [accountId, from, to]
    );

    const rows = result.rows
      .map((r) => ({
        channel: r.channel,
        label: adChannelLabel(r.channel),
        amount: Number(r.amount),
        attributed: r.attributed === true,
      }))
      .filter((r) => r.amount !== 0)
      .sort((a, b) => b.amount - a.amount);

    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    return {
      total,
      // Con total 0 no hay porcentaje que calcular; mostrar 0% es más honesto
      // que dividir por cero y pintar un NaN en la tabla.
      channels: rows.map((r) => ({ ...r, share: total > 0 ? r.amount / total : 0 })),
    };
  });
}

export async function GET(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";

  if (searchParams.get("groupBy") === "channel") {
    return NextResponse.json(await spendByChannel(account.id, from, to));
  }

  const rows = await withScope({ accountId: account.id }, async (client) => {
    const result = await client.query(
      `SELECT id, date, amount, channel FROM ads_spend
       WHERE account_id = $1 AND channel != 'mercado_ads' AND date BETWEEN $2::date AND $3::date
       ORDER BY date DESC`,
      [account.id, from, to]
    );
    return result.rows;
  });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { channel, date, amount } = body as { channel: unknown; date: unknown; amount: unknown };

  if (!isManualAdChannel(channel)) {
    return NextResponse.json({ error: "channel debe ser 'meta', 'google' o 'tiktok'" }, { status: 400 });
  }
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date debe tener formato YYYY-MM-DD" }, { status: 400 });
  }
  if (typeof amount !== "number" || amount < 0) {
    return NextResponse.json({ error: "amount debe ser un número >= 0" }, { status: 400 });
  }

  await withScope({ accountId: account.id }, (client) =>
    client.query(`INSERT INTO ads_spend (account_id, product_id, date, amount, channel) VALUES ($1, NULL, $2, $3, $4)`, [
      account.id,
      date,
      amount,
      channel,
    ])
  );
  return NextResponse.json({ ok: true });
}
