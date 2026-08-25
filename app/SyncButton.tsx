"use client";

import { useState } from "react";

interface SyncResponse {
  done: boolean;
  offset?: number;
  totalOrders?: number;
  productsSynced: number;
  ordersSynced: number;
  adsRowsSynced: number;
  billingChargesSynced?: number;
  error?: string;
}

export function SyncButton() {
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [mode, setMode] = useState<"normal" | "full">("normal");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function call(full: boolean, offset: number): Promise<SyncResponse> {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full, offset }),
    });
    const data = (await res.json()) as SyncResponse;
    if (!res.ok) throw new Error(data.error ?? "Error desconocido");
    return data;
  }

  async function handleSync(full: boolean) {
    setStatus("syncing");
    setMode(full ? "full" : "normal");
    setMessage("");
    setProgress(null);

    try {
      if (!full) {
        const data = await call(false, 0);
        setMessage(summarize(data));
        setStatus("done");
        return;
      }

      // El historial se procesa por lotes: cada request trae unas pocas
      // órdenes para no pasarse del límite de tiempo de la función.
      let offset = 0;
      const totals = { products: 0, orders: 0, ads: 0, billing: 0 };
      // Cota de seguridad: si el servidor dejara de avanzar el offset, esto
      // corta en vez de quedar girando para siempre.
      for (let batch = 0; batch < 500; batch += 1) {
        const data = await call(true, offset);
        totals.products += data.productsSynced;
        totals.orders += data.ordersSynced;
        totals.ads += data.adsRowsSynced;
        totals.billing += data.billingChargesSynced ?? 0;

        const next = data.offset ?? offset;
        setProgress({ done: next, total: data.totalOrders ?? next });
        if (data.done) break;
        if (next <= offset) throw new Error("El recálculo dejó de avanzar. Probá de nuevo.");
        offset = next;
      }

      setProgress(null);
      setMessage(
        `Listo · Productos: ${totals.products} · Órdenes: ${totals.orders} · Ads: ${totals.ads} · Cargos de ML: ${totals.billing}`
      );
      setStatus("done");
    } catch (err) {
      setProgress(null);
      setMessage((err as Error).message);
      setStatus("error");
    }
  }

  const syncing = status === "syncing";

  return (
    <div style={{ marginBottom: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => handleSync(false)} disabled={syncing}>
          {syncing && mode === "normal" ? "Sincronizando…" : "Sincronizar"}
        </button>
        <button className="btn btn-secondary" onClick={() => handleSync(true)} disabled={syncing}>
          {syncing && mode === "full" ? "Recalculando…" : "Recalcular historial"}
        </button>
        {progress && (
          <span role="status" aria-live="polite" className="field-hint" style={{ margin: 0 }}>
            {progress.done} de {progress.total} órdenes…
          </span>
        )}
        {message && (
          <span role="status" aria-live="polite" className={status === "error" ? "missing-cost" : "success-text"}>
            {message}
          </span>
        )}
      </div>
      <p className="field-hint" style={{ maxWidth: "70ch" }}>
        <strong>Sincronizar</strong> trae solo las ventas nuevas.{" "}
        <strong>Recalcular historial</strong> vuelve a leer todas tus ventas desde Mercado Libre y recalcula
        envíos, IVA y ganancia — usalo después de cargar costos o si ves números en $0. Va de a tandas y
        puede tardar varios minutos; no cierres la pestaña.
      </p>
    </div>
  );
}

function summarize(data: SyncResponse) {
  return `Productos: ${data.productsSynced} · Órdenes: ${data.ordersSynced} · Ads: ${data.adsRowsSynced} · Cargos de ML: ${data.billingChargesSynced ?? 0}`;
}
