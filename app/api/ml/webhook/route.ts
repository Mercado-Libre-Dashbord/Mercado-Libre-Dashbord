import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Receptor mínimo para las notificaciones/webhooks de Mercado Libre. Hoy la
// app funciona por polling (Sincronizar, GET /api/questions) — esto solo
// existe para que el campo "Notificaciones callbacks URL" de developers.
// mercadolibre.com tenga una URL válida y no bloquee guardar el resto de la
// configuración. ML espera un 200 rápido o reintenta, así que no hacemos
// ningún trabajo pesado (ni DB, ni llamadas a la API de ML) acá adentro.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("ML webhook recibido (sin procesar todavía):", body?.topic, body?.resource);
  } catch {
    // Si no viene JSON válido, no hay nada que loguear — igual respondemos 200.
  }
  return NextResponse.json({ ok: true });
}
