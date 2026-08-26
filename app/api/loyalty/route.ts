import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import { getProgram, saveProgram } from "@/db/loyalty";
import { MISSIONS, validateConfig, type MissionId } from "@/lib/loyalty";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

export async function GET() {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const data = await withScope({ accountId: account.id }, async (client) => {
    if (!(await hasColumn(client, "loyalty_programs", "account_id"))) {
      return { available: false, missions: MISSIONS, program: null };
    }
    return { available: true, missions: MISSIONS, program: await getProgram(client, account.id) };
  });

  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { active, points, rewardThreshold, rewardAmount, rewardMinPurchase, rewardBudget } = body as Record<string, any>;

  const program = {
    active: Boolean(active),
    points: points as Record<MissionId, number>,
    rewardThreshold: Number(rewardThreshold),
    rewardAmount: Number(rewardAmount),
    rewardMinPurchase: Number(rewardMinPurchase),
    rewardBudget: Number(rewardBudget),
  };

  // Se valida antes de guardar: el programa emite cupones con plata real, y
  // una configuración imposible recién se notaría cuando ML rechace un canje.
  const errors = validateConfig(program);
  if (!Number.isFinite(program.rewardBudget) || program.rewardBudget <= 0) {
    errors.push({ field: "rewardBudget", message: "El presupuesto de la campaña tiene que ser mayor a 0." });
  }
  if (errors.length > 0) return NextResponse.json({ errors }, { status: 400 });

  const saved = await withScope({ accountId: account.id }, async (client) => {
    if (!(await hasColumn(client, "loyalty_programs", "account_id"))) return false;
    await saveProgram(client, account.id, program);
    return true;
  });

  if (!saved) {
    return NextResponse.json(
      { error: "Falta correr db/postgres/migrations/009-loyalty.sql." },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true });
}
