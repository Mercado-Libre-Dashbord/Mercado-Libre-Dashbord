import { NextRequest, NextResponse } from "next/server";
import { withScope } from "@/db/client";
import { hasColumn } from "@/db/schema-capabilities";
import {
  completedMissions, getGrantedReward, getProgram, grantReward, recordCompletion, upsertMember,
} from "@/db/loyalty";
import { MISSION_BY_ID, hasEarnedReward, pointsToReward, totalPoints, type MissionId } from "@/lib/loyalty";
import { createSellerCoupon } from "@/mcp/tools";
import { resolveCurrentAccount } from "@/lib/current-account";

export const runtime = "nodejs";

/**
 * Alta de un miembro y registro de misiones cumplidas.
 *
 * Es el punto de entrada para la app que capta al comprador (el escaneo del
 * QR y la tarjeta en la billetera viven afuera de este proyecto). Acá se
 * lleva la cuenta de puntos y, cuando alcanza el objetivo, se emite el cupón
 * oficial de Mercado Libre.
 */
export async function POST(request: NextRequest) {
  const account = await resolveCurrentAccount();
  if (!account) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const memberId = String(body.memberId ?? "").trim();
  const mission = body.mission as MissionId | undefined;

  if (!memberId) return NextResponse.json({ error: "memberId es requerido" }, { status: 400 });
  if (mission && !MISSION_BY_ID.has(mission)) {
    return NextResponse.json({ error: `Misión desconocida: ${mission}` }, { status: 400 });
  }

  const result = await withScope({ accountId: account.id }, async (client) => {
    if (!(await hasColumn(client, "loyalty_programs", "account_id"))) return null;

    const program = await getProgram(client, account.id);
    if (!program.active) return { error: "El programa de fidelización está desactivado." };

    await upsertMember(client, account.id, memberId, { email: body.email, name: body.name });
    if (mission) await recordCompletion(client, account.id, memberId, mission);

    const completed = await completedMissions(client, account.id, memberId);
    const alreadyGranted = await getGrantedReward(client, account.id, memberId);

    // El cupón se emite una sola vez por miembro: el chequeo va antes de
    // llamar a ML para no crear campañas de más si se reintenta el pedido.
    let couponCode = alreadyGranted;
    if (!alreadyGranted && hasEarnedReward(program, completed)) {
      const coupon = await createSellerCoupon(account.id, {
        name: `Fidelización · ${memberId}`,
        amount: program.rewardAmount,
        minPurchase: program.rewardMinPurchase,
        budget: program.rewardBudget,
        durationDays: 30,
      });
      couponCode = coupon.code ?? coupon.id;
      await grantReward(client, account.id, memberId, couponCode);
    }

    return {
      memberId,
      completed,
      points: totalPoints(program, completed),
      pointsToReward: pointsToReward(program, completed),
      rewardUnlocked: Boolean(couponCode),
      couponCode,
    };
  });

  if (result === null) {
    return NextResponse.json({ error: "Falta correr db/postgres/migrations/009-loyalty.sql." }, { status: 503 });
  }
  if ("error" in result) return NextResponse.json(result, { status: 409 });
  return NextResponse.json(result);
}
