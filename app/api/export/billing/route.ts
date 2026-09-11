import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { resolveCurrentAccount } from "@/lib/current-account";
import { classifyCharge, chargeCode, BUCKET_LABEL, CHARGE_CODE_LABEL } from "@/sync/billing";

export const runtime = "nodejs";

/**
 * Los cargos que Mercado Libre facturó, en CSV, listos para el contador.
 *
 * Es lo que hoy se arma a mano: entrar a la cuenta, bajar el resumen de cada
 * período y reenviarlo. Acá sale clasificado por concepto —comisión, envío,
 * impuesto, publicidad, costo financiero— y con el número de orden al lado,
 * que es lo que permite cruzar un cargo contra la venta que lo generó.
 *
 * Los montos van tal como los devolvió ML, con su signo: un cargo es plata
 * que sale (negativo) y una nota de crédito por una devolución es plata que
 * vuelve (positivo). Normalizarlos a positivo haría que la suma de la
 * columna no diera el saldo del período, que es justo lo que el contador
 * necesita que dé.
 */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface ChargeRow {
  detailId: string;
  periodKey: string;
  detailType: string | null;
  detailSubType: string | null;
  concept: string | null;
  orderId: string | null;
  amount: number;
  chargedAt: string | null;
}

export async function GET(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";

  const rows = await withScope({ accountId: account.id }, async (client) => {
    if (!(await hasColumn(client, "billing_charges", "detail_id"))) return [];
    const result = await client.query<ChargeRow>(
      `SELECT detail_id as "detailId", period_key as "periodKey", detail_type as "detailType",
              detail_sub_type as "detailSubType", concept, order_id as "orderId",
              amount, charged_at as "chargedAt"
         FROM billing_charges
        WHERE account_id = $1 AND (charged_at IS NULL OR charged_at::date BETWEEN $2::date AND $3::date)
        ORDER BY charged_at NULLS LAST, detail_id`,
      [account.id, from, to]
    );
    return result.rows;
  });

  const header = [
    "periodo", "fecha", "id_cargo", "codigo_ml", "concepto", "categoria", "orden", "importe",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const code = chargeCode(r.detailType, r.detailSubType, r.concept);
    lines.push(
      [
        csvCell(r.periodKey),
        csvCell(r.chargedAt ? new Date(r.chargedAt).toISOString().slice(0, 10) : null),
        csvCell(r.detailId),
        csvCell(code ? code.toUpperCase() : null),
        // Cuando se pudo identificar el código, su nombre; si no, el texto que
        // mandó ML, que es lo único que hay.
        csvCell(code ? CHARGE_CODE_LABEL[code] : r.concept),
        csvCell(BUCKET_LABEL[classifyCharge(r.concept, r.detailType, r.detailSubType)]),
        csvCell(r.orderId),
        csvCell(Number(r.amount)),
      ].join(",")
    );
  }
  // BOM UTF-8: sin esto, Excel en Windows abre las tildes como caracteres
  // sueltos en vez de detectar UTF-8 solo.
  const csv = "﻿" + lines.join("\n") + "\n";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cargos-mercado-libre-${from}-a-${to}.csv"`,
    },
  });
}
