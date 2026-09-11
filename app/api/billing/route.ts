import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { resolveCurrentAccount } from "@/lib/current-account";
import { classifyCharge, BUCKET_LABEL, type ChargeBucket } from "@/sync/billing";

export const runtime = "nodejs";

interface ChargeRow {
  concept: string | null;
  detailType: string | null;
  detailSubType: string | null;
  amount: number;
  documentType: string | null;
}

/**
 * Lo que Mercado Libre efectivamente facturó en el período, agrupado por
 * concepto. Es el número "de verdad" contra el que conciliar lo que la app
 * estima orden por orden.
 */
export async function GET(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";

  const data = await withScope({ accountId: account.id }, async (client) => {
    // La tabla llega por migración manual; sin ella se devuelve vacío en vez
    // de romper la página (ver db/schema-capabilities.ts).
    if (!(await hasColumn(client, "billing_charges", "detail_id"))) {
      return { available: false, buckets: [], total: 0, creditNotes: { count: 0, amount: 0 } };
    }

    // La columna que separa cargos de notas de crédito llega por migración
    // (016); sin ella todo lo guardado son cargos, como hasta ahora.
    const documentType = (await hasColumn(client, "billing_charges", "document_type"))
      ? "document_type"
      : "'BILL'::text";

    const result = await client.query<ChargeRow>(
      `SELECT concept, detail_type as "detailType", detail_sub_type as "detailSubType", amount,
              ${documentType} as "documentType"
       FROM billing_charges
       WHERE account_id = $1 AND (charged_at IS NULL OR charged_at::date BETWEEN $2::date AND $3::date)`,
      [account.id, from, to]
    );

    // Las notas de crédito entran en el mismo bucket que el cargo que
    // reintegran, con el signo opuesto: así "Comisiones de venta" muestra lo
    // que ML se quedó de verdad y no lo que cobró antes de las devoluciones.
    // Se cuentan además por separado, porque una cuenta con muchas
    // devoluciones tiene un problema que el neto justamente esconde.
    const totals = new Map<ChargeBucket, number>();
    let creditNoteCount = 0;
    let creditNoteAmount = 0;
    for (const row of result.rows) {
      const bucket = classifyCharge(row.concept, row.detailType, row.detailSubType);
      totals.set(bucket, (totals.get(bucket) ?? 0) + Number(row.amount));
      if (row.documentType === "CREDIT_NOTE") {
        creditNoteCount += 1;
        creditNoteAmount += Number(row.amount);
      }
    }

    const buckets = [...totals.entries()]
      .map(([bucket, amount]) => ({ bucket, label: BUCKET_LABEL[bucket], amount }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    return {
      available: true,
      buckets,
      total: buckets.reduce((sum, b) => sum + b.amount, 0),
      charges: result.rows.length,
      creditNotes: { count: creditNoteCount, amount: creditNoteAmount },
    };
  });

  return NextResponse.json(data);
}
