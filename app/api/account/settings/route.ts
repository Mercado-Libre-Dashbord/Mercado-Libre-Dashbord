import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { setAccountOtherTaxRate } from "@/db/accounts";
import { getCurrentUser, resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

/** Tope defensivo: una alícuota por encima de esto es un error de tipeo
 *  (alguien puso "21" queriendo decir 21%, no 2100%). */
const MAX_RATE = 1;

export async function GET() {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json({ otherTaxRate: account.otherTaxRate, name: account.name });
}

export async function PATCH(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { otherTaxRate } = body as { otherTaxRate?: number };
  if (typeof otherTaxRate !== "number" || !Number.isFinite(otherTaxRate) || otherTaxRate < 0 || otherTaxRate > MAX_RATE) {
    return NextResponse.json({ error: "La alícuota tiene que estar entre 0% y 100%." }, { status: 400 });
  }

  // La política RLS de `accounts` autoriza por email/admin, no por
  // account_id: sin pasar el usuario, el UPDATE no afecta ninguna fila y el
  // guardado fallaría en silencio.
  const user = await getCurrentUser();
  const saved = await withScope(
    { accountId: account.id, userEmail: user?.email ?? null, isAdmin: user?.isAdmin },
    async (client) => {
      if (!(await hasColumn(client, "accounts", "other_tax_rate"))) return false;
      await setAccountOtherTaxRate(client, account.id, otherTaxRate);
      return true;
    }
  );

  if (!saved) {
    return NextResponse.json(
      { error: "Falta correr la migración db/postgres/migrations/005-impuesto-por-cuenta.sql." },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, otherTaxRate });
}
