"use client";

import { useState } from "react";

export function SyncButton() {
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [mode, setMode] = useState<"normal" | "full">("normal");
  const [message, setMessage] = useState("");

  async function handleSync(full: boolean) {
    setStatus("syncing");
    setMode(full ? "full" : "normal");
    setMessage("");
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error desconocido");
      setMessage(
        `Productos: ${data.productsSynced} · Órdenes: ${data.ordersSynced} · Ads: ${data.adsRowsSynced} · Cargos de ML: ${data.billingChargesSynced ?? 0}`
      );
      setStatus("done");
    } catch (err) {
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
        {/* Un sync normal solo trae ventas nuevas. Este relee TODO el historial
            contra la API de Mercado Libre — es la única forma de rellenar datos
            que se guardaron mal en su momento (el envío en $0, por ejemplo). */}
        <button className="btn btn-secondary" onClick={() => handleSync(true)} disabled={syncing}>
          {syncing && mode === "full" ? "Recalculando todo…" : "Recalcular historial"}
        </button>
        {message && (
          <span role="status" aria-live="polite" className={status === "error" ? "missing-cost" : "success-text"}>
            {message}
          </span>
        )}
      </div>
      <p className="field-hint" style={{ maxWidth: "70ch" }}>
        <strong>Sincronizar</strong> trae solo las ventas nuevas.{" "}
        <strong>Recalcular historial</strong> vuelve a leer todas tus ventas desde Mercado Libre y recalcula
        envíos, impuestos y ganancia — usalo después de cargar costos o si ves números en $0. Tarda más.
      </p>
    </div>
  );
}
