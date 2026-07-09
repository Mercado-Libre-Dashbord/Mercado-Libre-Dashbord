"use client";

import { useEffect, useState } from "react";

interface Product {
  id: string;
  title: string;
  sku: string | null;
  currentPrice: number;
  stock: number;
  currentCost: number | null;
}

export default function ProductosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});

  function load() {
    fetch("/api/products")
      .then((r) => r.json())
      .then(setProducts);
  }

  useEffect(load, []);

  async function saveCost(productId: string) {
    const cost = Number(editing[productId]);
    if (Number.isNaN(cost) || cost < 0) return;
    await fetch("/api/products", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, cost }),
    });
    setEditing((prev) => ({ ...prev, [productId]: "" }));
    load();
  }

  return (
    <div>
      <h1>Productos</h1>
      <table>
        <thead>
          <tr>
            <th>Título</th>
            <th>SKU</th>
            <th>Precio</th>
            <th>Stock</th>
            <th>Costo vigente</th>
            <th>Nuevo costo</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>{p.title}</td>
              <td>{p.sku ?? "-"}</td>
              <td>{p.currentPrice}</td>
              <td>{p.stock}</td>
              <td className={p.currentCost === null ? "missing-cost" : undefined}>
                {p.currentCost === null ? "Sin costo cargado" : p.currentCost}
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={editing[p.id] ?? ""}
                  onChange={(e) => setEditing((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  style={{ width: 80 }}
                />
                <button onClick={() => saveCost(p.id)}>Guardar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
