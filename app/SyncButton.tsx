"use client";

import { useState } from "react";

export function SyncButton() {
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSync() {
    setStatus("syncing");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error desconocido");
      setMessage(`Productos: ${data.productsSynced} · Órdenes: ${data.ordersSynced} · Ads: ${data.adsRowsSynced}`);
      setStatus("done");
    } catch (err) {
      setMessage((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <div style={{ marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
      <button className="btn btn-primary" onClick={handleSync} disabled={status === "syncing"}>
        {status === "syncing" ? "Sincronizando…" : "Sincronizar"}
      </button>
      {message && (
        <span role="status" aria-live="polite" className={status === "error" ? "missing-cost" : "success-text"}>
          {message}
        </span>
      )}
    </div>
  );
}
