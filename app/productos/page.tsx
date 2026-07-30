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
  unitsSold: number;
  totalProfit: number;
  marginPct: number | null;
}

export default function ProductosPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);

  function load() {
    fetch("/api/products").then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then(setProducts);
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

  async function saveCost(productId: string) {
    const raw = editing[productId] ?? "";
    const cost = Number(raw);
    if (raw.trim() === "" || Number.isNaN(cost) || cost < 0) {
      setErrors((prev) => ({ ...prev, [productId]: "Ingresá un costo válido (mayor o igual a 0)." }));
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

  return (
    <div>
      <h1>Productos</h1>
      {products === null ? (
        <p className="empty-state">Cargando productos…</p>
      ) : products.length === 0 ? (
        <div className="empty-state">
          Todavía no hay productos sincronizados. Conectá Mercado Libre y apretá &quot;Sincronizar&quot; en Resumen.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Título</th>
                <th>SKU</th>
                <th className="num">Precio</th>
                <th className="num">Stock</th>
                <th className="num">Costo vigente</th>
                <th className="num">Margen %</th>
                <th className="num">Unidades vendidas</th>
                <th className="num">Rentabilidad total</th>
                <th>Nuevo costo</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td>{p.sku ?? "-"}</td>
                  <td className="num">{p.currentPrice?.toFixed(2)}</td>
                  <td className="num">{p.stock}</td>
                  <td className={`num ${p.currentCost === null ? "missing-cost" : ""}`}>
                    {p.currentCost === null ? "Sin costo cargado" : p.currentCost.toFixed(2)}
                  </td>
                  <td className="num">{p.marginPct === null ? "-" : `${(p.marginPct * 100).toFixed(1)}%`}</td>
                  <td className="num">{p.unitsSold}</td>
                  <td className="num">{p.totalProfit.toFixed(2)}</td>
                  <td>
                    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "start" }}>
                      <div className="field-group">
                        <label className="field-hint" htmlFor={`cost-${p.id}`} style={{ position: "absolute", clip: "rect(0 0 0 0)" }}>
                          Nuevo costo para {p.title}
                        </label>
                        <input
                          id={`cost-${p.id}`}
                          type="number"
                          min="0"
                          inputMode="decimal"
                          aria-invalid={errors[p.id] ? true : undefined}
                          value={editing[p.id] ?? ""}
                          onChange={(e) => {
                            setEditing((prev) => ({ ...prev, [p.id]: e.target.value }));
                            if (errors[p.id]) setErrors((prev) => ({ ...prev, [p.id]: "" }));
                          }}
                          style={{ width: 90 }}
                        />
                        {errors[p.id] && <p className="field-error">{errors[p.id]}</p>}
                      </div>
                      <button className="btn btn-secondary btn-sm" onClick={() => saveCost(p.id)} disabled={savingId === p.id}>
                        {savingId === p.id ? "Guardando…" : "Guardar"}
                      </button>
                    </div>
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
