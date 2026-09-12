"use client";

import { useState } from "react";

interface SyncResponse {
  done: boolean;
  productsSynced: number;
  ordersSynced: number;
  adsRowsSynced: number;
  billingChargesSynced?: number;
  /** scroll_id de catálogo para retomar el escaneo donde quedó. */
  productsScrollId?: string;
  /** Si el catálogo ya quedó sincronizado del todo. */
  productsDone?: boolean;
  /** En qué ventana de fecha de órdenes seguir. */
  ordersWindowIndex?: number;
  /** Desde qué orden, dentro de esa ventana, seguir. */
  ordersOffsetInWindow?: number;
  error?: string;
}

interface CallBody {
  productsScrollId?: string;
  productsDone?: boolean;
  ordersWindowIndex?: number;
  ordersOffsetInWindow?: number;
}

export function SyncButton() {
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<string | null>(null);

  async function call(body: CallBody, attempt = 0): Promise<SyncResponse> {
    let res: Response;
    try {
      res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // El fetch se cortó a nivel de red (señal débil, timeout, el servidor
      // cerró la conexión) — en Safari esto llega como el genérico "Load
      // failed", sin ningún detalle útil. Es justo el tipo de error
      // transitorio que un reintento suele resolver solo, así que se
      // reintenta un par de veces con espera creciente antes de rendirse.
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        return call(body, attempt + 1);
      }
      throw new Error("Se cortó la conexión con el servidor (señal débil o tardó demasiado). Probá de nuevo.");
    }

    let data: SyncResponse;
    try {
      data = (await res.json()) as SyncResponse;
    } catch {
      // Una respuesta que no es JSON (por ejemplo, una página de error de
      // Vercel por timeout) daría un error de parseo ilegible en vez de
      // decir lo que realmente pasó.
      throw new Error(`El servidor no respondió bien (${res.status}). Probá de nuevo en un momento.`);
    }
    if (!res.ok) throw new Error(data.error ?? "Error desconocido");
    return data;
  }

  /**
   * Un solo sync que recorre todo el catálogo y todo el historial por lotes.
   * El servidor saltea las órdenes que ya están al día, así que después de la
   * primera vez esto termina en segundos aunque mire todas las ventas. Un
   * catálogo grande (decenas de miles de publicaciones) tampoco entra en una
   * sola llamada al servidor, así que primero puede haber varias vueltas
   * escaneando productos antes de que arranque el progreso de órdenes — y el
   * historial de órdenes va por ventanas de fecha (no un solo número de
   * offset), así que el progreso se muestra como cantidad procesada, no como
   * fracción de un total.
   */
  async function handleSync() {
    setStatus("syncing");
    setMessage("");
    setProgress(null);

    try {
      const totals = { products: 0, orders: 0, ads: 0, billing: 0 };
      let productsScrollId: string | undefined;
      let productsDone = false;
      let ordersWindowIndex = 0;
      let ordersOffsetInWindow = 0;

      // Cota de seguridad: si el servidor dejara de avanzar (ni el catálogo
      // ni la posición de órdenes), esto corta en vez de quedar girando para
      // siempre.
      for (let batch = 0; batch < 3000; batch += 1) {
        const data = await call({ productsScrollId, productsDone, ordersWindowIndex, ordersOffsetInWindow });
        totals.products += data.productsSynced;
        totals.orders += data.ordersSynced;
        totals.ads += data.adsRowsSynced;
        totals.billing += data.billingChargesSynced ?? 0;

        productsDone = data.productsDone === true;

        if (!productsDone) {
          // Todavía escaneando el catálogo: uno grande no entra en una sola
          // llamada, así que esto puede tardar varias vueltas.
          if (data.productsScrollId === productsScrollId) {
            throw new Error("La sincronización del catálogo dejó de avanzar. Probá de nuevo.");
          }
          productsScrollId = data.productsScrollId;
          setProgress(`Escaneando catálogo… ${totals.products} publicaciones`);
          continue;
        }

        setProgress(`${totals.orders} órdenes sincronizadas…`);
        if (data.done) break;

        const nextWindowIndex = data.ordersWindowIndex ?? ordersWindowIndex;
        const nextOffsetInWindow = data.ordersOffsetInWindow ?? ordersOffsetInWindow;
        if (nextWindowIndex === ordersWindowIndex && nextOffsetInWindow === ordersOffsetInWindow) {
          throw new Error("La sincronización dejó de avanzar. Probá de nuevo.");
        }
        ordersWindowIndex = nextWindowIndex;
        ordersOffsetInWindow = nextOffsetInWindow;
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
            {progress}
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
