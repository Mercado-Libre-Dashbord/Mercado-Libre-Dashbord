import { NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { setLoyaltyApiKeyHash } from "@/db/accounts";
import { generateApiKey, hashApiKey } from "@/lib/loyalty-auth";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

/**
 * Genera (o rota) la credencial que usa la app de fidelización.
 *
 * Devuelve la clave en claro UNA sola vez: en la base queda el hash. Si se
 * pierde, no se recupera — se genera otra, y la anterior deja de servir en el
 * acto. Es a propósito: una credencial que se puede volver a leer desde la
 * base es una credencial que se filtra con la base.
 */
export async function POST() {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const key = generateApiKey();
  const outcome = await withScope({ accountId: account.id, userEmail: account.ownerEmail }, async (client) => {
    if (!(await hasColumn(client, "accounts", "loyalty_api_key_hash"))) return "sin-migracion" as const;
    return (await setLoyaltyApiKeyHash(client, account.id, hashApiKey(key))) ? ("ok" as const) : ("no-escribio" as const);
  });

  if (outcome === "sin-migracion") {
    return NextResponse.json(
      { error: "Falta correr db/postgres/migrations/010-loyalty-api-key.sql." },
      { status: 503 }
    );
  }
  if (outcome === "no-escribio") {
    // Devolver la clave igual sería peor que fallar: el vendedor la copiaría,
    // la app la usaría y recibiría 401 sin que nadie entienda por qué.
    return NextResponse.json(
      { error: "No se pudo guardar la credencial. Volvé a intentar; si sigue, avisanos." },
      { status: 500 }
    );
  }
  return NextResponse.json({ apiKey: key });
}
