"use client";

import { useEffect, useState } from "react";
import { NoAccountState } from "../NoAccountState";

interface Product {
  id: string;
  title: string;
  sku: string | null;
  currentPrice: number;
  stock: number;
  currentCost: number | null;
  thumbnail: string | null;
  unitsSold: number;
  totalProfit: number;
  marginPct: number | null;
  logisticType: string | null;
  fullStockQty: number | null;
  fullStockUnavailableQty: number | null;
  /** Stock guardado en Full si el producto está ahí; si no, el de la
   * publicación. Ya calculado del lado del servidor para que el aviso, el
   * resaltado de la fila y el número mostrado nunca puedan desacordar. */
  effectiveStock: number;
  fullStockValue: number | null;
  lowStockThreshold: number | null;
  lowStock: boolean;
}

/**
 * Avisa qué productos están por debajo del umbral de stock que el vendedor
 * configuró. Mismo criterio que el aviso de costos faltantes: una lista de
 * qué producto puntualmente hay que reponer, no solo un contador.
 */
function LowStockPanel({ products }: { products: Product[] }) {
  const low = products.filter((p) => p.lowStock);
  if (low.length === 0) return null;
  return (
    <div className="missing-cost-panel" role="status">
      <p className="missing-cost-head">
        <strong>{low.length} producto(s) con stock bajo el umbral configurado.</strong> Conviene reponerlos antes
        de quedarte sin stock.
      </p>
      <ul className="missing-cost-list">
        {low.slice(0, 10).map((p) => (
          <li key={p.id}>
            <span className="missing-cost-title">{p.title}</span>
            <span className="missing-cost-units">
              {p.effectiveStock} / {p.lowStockThreshold}{p.logisticType === "fulfillment" ? " (Full)" : ""}
            </span>
          </li>
        ))}
      </ul>
      {low.length > 10 && <p className="missing-cost-foot">Y {low.length - 10} más.</p>}
    </div>
  );
}

export default function ProductosPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Edición de precio/stock que se escribe de vuelta a la publicación real en
  // Mercado Libre — separado a propósito de "editing" (que es el costo,
  // interno nuestro, nunca toca ML).
  const [mlEditing, setMlEditing] = useState<Record<string, { price: string; stock: string }>>({});
  const [mlErrors, setMlErrors] = useState<Record<string, string>>({});
  const [mlSavingId, setMlSavingId] = useState<string | null>(null);

  // Umbral de alerta de stock bajo, por producto.
  const [thresholdEditing, setThresholdEditing] = useState<Record<string, string>>({});
  const [thresholdErrors, setThresholdErrors] = useState<Record<string, string>>({});
  const [thresholdSavingId, setThresholdSavingId] = useState<string | null>(null);

  function load() {
    setLoadError("");
    fetch("/api/products")
      .then(async (r) => {
        if (r.status === 401) { setNoAccount(true); return; }
        if (!r.ok) throw new Error(String(r.status));
        setProducts(await r.json());
      })
      .catch(() => {
        // Sin esto la página se quedaba para siempre en "Cargando productos…"
        // cuando la API fallaba, y parecía que se habían borrado los costos.
        setLoadError("No se pudieron cargar los productos. Probá recargar la página.");
        setProducts([]);
      });
  }

  useEffect(load, []);

  if (noAccount) {
    return (
      <div>
        <h1>Productos</h1>
        <NoAccountState />
      </div>
    );
  }

  function startMlEdit(p: Product) {
    setMlEditing((prev) => ({ ...prev, [p.id]: { price: String(p.currentPrice), stock: String(p.stock) } }));
  }

  function cancelMlEdit(productId: string) {
    setMlEditing((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setMlErrors((prev) => ({ ...prev, [productId]: "" }));
  }

  async function saveMlEdit(productId: string) {
    const draft = mlEditing[productId];
    const price = Number(draft?.price);
    const stock = Number(draft?.stock);
    if (!draft || Number.isNaN(price) || price <= 0 || Number.isNaN(stock) || stock < 0 || !Number.isInteger(stock)) {
      setMlErrors((prev) => ({ ...prev, [productId]: "Precio > 0 y stock entero ≥ 0." }));
      return;
    }
    setMlErrors((prev) => ({ ...prev, [productId]: "" }));
    setMlSavingId(productId);
    try {
      const res = await fetch("/api/products/ml-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, price, stock }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMlErrors((prev) => ({ ...prev, [productId]: data.error ?? "No se pudo guardar en Mercado Libre." }));
        return;
      }
      cancelMlEdit(productId);
      load();
    } finally {
      setMlSavingId(null);
    }
  }

  async function saveCost(productId: string) {
    const draft = editing[productId] ?? "";
    const cost = Number(draft);
    if (draft.trim() === "" || Number.isNaN(cost) || cost < 0) {
      setErrors((prev) => ({ ...prev, [productId]: "Ingresá un costo (≥ 0)." }));
      return;
    }
    setErrors((prev) => ({ ...prev, [productId]: "" }));
    setSavingId(productId);
    try {
      await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, cost }),
      });
      setEditing((prev) => ({ ...prev, [productId]: "" }));
      load();
    } finally {
      setSavingId(null);
    }
  }

  async function saveThreshold(productId: string) {
    const draft = thresholdEditing[productId] ?? "";
    const lowStockThreshold = draft.trim() === "" ? null : Number(draft);
    if (lowStockThreshold !== null && (Number.isNaN(lowStockThreshold) || lowStockThreshold < 0 || !Number.isInteger(lowStockThreshold))) {
      setThresholdErrors((prev) => ({ ...prev, [productId]: "Entero ≥ 0, o vacío para sacar la alerta." }));
      return;
    }
    setThresholdErrors((prev) => ({ ...prev, [productId]: "" }));
    setThresholdSavingId(productId);
    try {
      await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, lowStockThreshold }),
      });
      setThresholdEditing((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      load();
    } finally {
      setThresholdSavingId(null);
    }
  }

  return (
    <div>
      <h1>Productos</h1>
      <p className="field-hint" style={{ marginBottom: "var(--space-3)" }}>
        Cargá el costo de compra por unidad. Los impuestos no van acá: el IVA se calcula solo al 21% y el resto
        (IIBB, internos) se configura una sola vez en <a href="/configuracion">Configuración</a>.
      </p>
      {loadError && <p className="field-error" role="alert" style={{ marginBottom: "var(--space-3)" }}>{loadError}</p>}
      {products && <LowStockPanel products={products} />}
      {products === null ? (
        <p className="empty-state">Cargando productos…</p>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <p style={{ margin: 0, fontWeight: 600, color: "var(--text)" }}>Todavía no hay productos sincronizados.</p>
          <p style={{ margin: "var(--space-2) 0 var(--space-3)" }}>
            Conectá Mercado Libre y sincronizá para traer tus publicaciones.
          </p>
          <a className="btn btn-primary btn-sm" href="/">Ir a Resumen y sincronizar</a>
        </div>
      ) : (
        <div className="table-wrap table-scroll table-compact">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Precio</th>
                <th className="num">Stock</th>
                <th className="num">Valor en Full</th>
                <th className="num">Costo</th>
                <th className="num">Margen</th>
                <th className="num">Vendidas</th>
                <th className="num">Rentabilidad</th>
                <th>Actualizar costo</th>
                <th>Alerta stock</th>
                <th>ML</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="cell-product">
                      {p.thumbnail ? (
                        <img className="cell-thumb" src={p.thumbnail} alt="" loading="lazy" />
                      ) : (
                        <span className="cell-thumb" aria-hidden="true" />
                      )}
                      <span style={{ minWidth: 0 }}>
                        <span className="cell-title" title={p.title}>{p.title}</span>
                        {p.sku && <span className="cell-sub">SKU {p.sku}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="num">
                    {mlEditing[p.id] ? (
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        aria-label={`Precio nuevo para ${p.title}`}
                        value={mlEditing[p.id].price}
                        onChange={(e) => setMlEditing((prev) => ({ ...prev, [p.id]: { ...prev[p.id], price: e.target.value } }))}
                        style={{ width: 74, padding: "5px" }}
                      />
                    ) : (
                      p.currentPrice?.toFixed(2)
                    )}
                  </td>
                  <td className={`num ${p.lowStock ? "missing-cost" : ""}`}>
                    {mlEditing[p.id] ? (
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        aria-label={`Stock nuevo para ${p.title}`}
                        value={mlEditing[p.id].stock}
                        onChange={(e) => setMlEditing((prev) => ({ ...prev, [p.id]: { ...prev[p.id], stock: e.target.value } }))}
                        style={{ width: 54, padding: "5px" }}
                      />
                    ) : p.logisticType === "fulfillment" && p.fullStockQty !== null ? (
                      <>
                        {p.effectiveStock} <span className="badge badge-other">Full</span>
                      </>
                    ) : (
                      p.effectiveStock
                    )}
                  </td>
                  <td className="num">{p.fullStockValue === null ? "—" : p.fullStockValue.toFixed(2)}</td>
                  <td className={`num ${p.currentCost === null ? "missing-cost" : ""}`}>
                    {p.currentCost === null ? "Sin costo cargado" : p.currentCost.toFixed(2)}
                  </td>
                  <td className="num">{p.marginPct === null ? "-" : `${(p.marginPct * 100).toFixed(1)}%`}</td>
                  <td className="num">{p.unitsSold}</td>
                  <td className="num">{p.totalProfit.toFixed(2)}</td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                      <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
                        <input
                          id={`cost-${p.id}`}
                          type="number"
                          min="0"
                          inputMode="decimal"
                          placeholder="Costo"
                          aria-label={`Nuevo costo para ${p.title}`}
                          aria-invalid={errors[p.id] ? true : undefined}
                          value={editing[p.id] ?? ""}
                          onChange={(e) => {
                            setEditing((prev) => ({ ...prev, [p.id]: e.target.value }));
                            if (errors[p.id]) setErrors((prev) => ({ ...prev, [p.id]: "" }));
                          }}
                          style={{ width: 76, padding: "6px" }}
                        />
                        <button className="btn btn-secondary btn-sm" onClick={() => saveCost(p.id)} disabled={savingId === p.id}>
                          {savingId === p.id ? "…" : "Guardar"}
                        </button>
                      </div>
                      {errors[p.id] && <p className="field-error">{errors[p.id]}</p>}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                      <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
                        <input
                          id={`threshold-${p.id}`}
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          placeholder="Sin alerta"
                          aria-label={`Umbral de stock bajo para ${p.title}`}
                          aria-invalid={thresholdErrors[p.id] ? true : undefined}
                          // Precargado con el valor guardado (no solo como
                          // placeholder): así, si el vendedor aprieta
                          // "Guardar" sin tocar nada, no manda un campo
                          // vacío que borraría una alerta ya configurada.
                          value={thresholdEditing[p.id] ?? (p.lowStockThreshold !== null ? String(p.lowStockThreshold) : "")}
                          onChange={(e) => {
                            setThresholdEditing((prev) => ({ ...prev, [p.id]: e.target.value }));
                            if (thresholdErrors[p.id]) setThresholdErrors((prev) => ({ ...prev, [p.id]: "" }));
                          }}
                          style={{ width: 76, padding: "6px" }}
                        />
                        <button className="btn btn-secondary btn-sm" onClick={() => saveThreshold(p.id)} disabled={thresholdSavingId === p.id}>
                          {thresholdSavingId === p.id ? "…" : "Guardar"}
                        </button>
                      </div>
                      {thresholdErrors[p.id] && <p className="field-error">{thresholdErrors[p.id]}</p>}
                    </div>
                  </td>
                  <td>
                    {mlEditing[p.id] ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", alignItems: "start" }}>
                        <div style={{ display: "flex", gap: "var(--space-1)" }}>
                          <button className="btn btn-primary btn-sm" onClick={() => saveMlEdit(p.id)} disabled={mlSavingId === p.id}>
                            {mlSavingId === p.id ? "Guardando…" : "Guardar"}
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => cancelMlEdit(p.id)} disabled={mlSavingId === p.id}>
                            Cancelar
                          </button>
                        </div>
                        {mlErrors[p.id] && <p className="field-error">{mlErrors[p.id]}</p>}
                      </div>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => startMlEdit(p)}>
                        Editar precio/stock
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
