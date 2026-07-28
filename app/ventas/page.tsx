"use client";

import { useEffect, useState } from "react";

interface OrderItem {
  id: number;
  orderId: string;
  dateCreated: string;
  productId: string;
  productTitle: string;
  unitPrice: number;
  quantity: number;
  mlCommission: number;
  shippingCost: number;
  adsCostAllocated: number;
  costApplied: number | null;
  netProfit: number | null;
  estadoPago: string;
}

interface ProductOption {
  id: string;
  title: string;
}

export default function VentasPage() {
  const [items, setItems] = useState<OrderItem[] | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [filters, setFilters] = useState({ productId: "", from: "", to: "", status: "" });

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((rows: ProductOption[]) => setProducts(rows));
  }, []);

  useEffect(() => {
    setItems(null);
    const params = new URLSearchParams();
    if (filters.productId) params.set("productId", filters.productId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.status) params.set("status", filters.status);
    fetch(`/api/orders?${params.toString()}`)
      .then((r) => r.json())
      .then(setItems);
  }, [filters]);

  return (
    <div>
      <h1>Ventas</h1>
      <div className="ad-form" style={{ marginBottom: 16 }}>
        <label>
          Producto
          <select
            value={filters.productId}
            onChange={(e) => setFilters((p) => ({ ...p, productId: e.target.value }))}
          >
            <option value="">Todos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input type="date" value={filters.from} onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
        </label>
        <label>
          Hasta
          <input type="date" value={filters.to} onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
        </label>
        <label>
          Estado
          <select value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
            <option value="">Todos</option>
            <option value="paid">Pagado</option>
            <option value="pending">Pendiente</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </label>
      </div>
      {items === null ? (
        <p className="empty-state">Cargando ventas…</p>
      ) : items.length === 0 ? (
        <div className="empty-state">No hay ventas para estos filtros.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Producto</th>
                <th className="num">Precio</th>
                <th className="num">Cant.</th>
                <th className="num">Comisión</th>
                <th className="num">Envío</th>
                <th className="num">Publicidad</th>
                <th className="num">Costo</th>
                <th className="num">Ganancia neta</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{new Date(it.dateCreated).toLocaleDateString("es-AR")}</td>
                  <td>{it.estadoPago}</td>
                  <td>{it.productTitle}</td>
                  <td className="num">{it.unitPrice.toFixed(2)}</td>
                  <td className="num">{it.quantity}</td>
                  <td className="num">{it.mlCommission.toFixed(2)}</td>
                  <td className="num">{it.shippingCost.toFixed(2)}</td>
                  <td className="num">{it.adsCostAllocated.toFixed(2)}</td>
                  <td className={`num ${it.costApplied === null ? "missing-cost" : ""}`}>
                    {it.costApplied === null ? "Sin costo" : it.costApplied.toFixed(2)}
                  </td>
                  <td className="num">{it.netProfit === null ? "-" : it.netProfit.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
