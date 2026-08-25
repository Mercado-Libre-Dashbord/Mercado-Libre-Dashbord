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
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function call(offset: number): Promise<SyncResponse> {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset }),
    });
    const data = (await res.json()) as SyncResponse;
    if (!res.ok) throw new Error(data.error ?? "Error desconocido");
    return data;
  }

  /**
   * Un solo sync que recorre todo el historial por lotes. El servidor saltea
   * las órdenes que ya están al día, así que después de la primera vez esto
   * termina en segundos aunque mire todas las ventas.
   */
  async function handleSync() {
    setStatus("syncing");
    setMessage("");
    setProgress(null);

    try {
      let offset = 0;
      const totals = { products: 0, orders: 0, ads: 0, billing: 0 };
      // Cota de seguridad: si el servidor dejara de avanzar el offset, esto
      // corta en vez de quedar girando para siempre.
      for (let batch = 0; batch < 500; batch += 1) {
        const data = await call(offset);
        totals.products += data.productsSynced;
        totals.orders += data.ordersSynced;
        totals.ads += data.adsRowsSynced;
        totals.billing += data.billingChargesSynced ?? 0;

        const next = data.offset ?? offset;
        setProgress({ done: next, total: data.totalOrders ?? next });
        if (data.done) break;
        if (next <= offset) throw new Error("La sincronización dejó de avanzar. Probá de nuevo.");
        offset = next;
      }

      setProgress(null);
      setMessage(
        `Listo · Productos: ${totals.products} · Ventas actualizadas: ${totals.orders} · Ads: ${totals.ads} · Cargos de ML: ${totals.billing}`
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
        <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
          {syncing ? "Sincronizando…" : "Sincronizar"}
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
        Trae tus ventas nuevas y recalcula envíos, IVA y ganancia de todo el historial. La primera vez puede
        tardar varios minutos; después es cuestión de segundos porque saltea lo que ya está al día.
      </p>
    </div>
  );
}
