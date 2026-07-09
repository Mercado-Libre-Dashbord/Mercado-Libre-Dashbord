"use client";

import { useEffect, useState } from "react";

interface OrderItem {
  id: number;
  orderId: string;
  dateCreated: string;
  productTitle: string;
  unitPrice: number;
  quantity: number;
  mlCommission: number;
  shippingCost: number;
  adsCostAllocated: number;
  costApplied: number | null;
  netProfit: number | null;
}

export default function VentasPage() {
  const [items, setItems] = useState<OrderItem[]>([]);

  useEffect(() => {
    fetch("/api/orders")
      .then((r) => r.json())
      .then(setItems);
  }, []);

  return (
    <div>
      <h1>Ventas</h1>
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Producto</th>
            <th>Precio</th>
            <th>Cant.</th>
            <th>Comisión</th>
            <th>Envío</th>
            <th>Publicidad</th>
            <th>Costo</th>
            <th>Ganancia neta</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>{new Date(it.dateCreated).toLocaleDateString("es-AR")}</td>
              <td>{it.productTitle}</td>
              <td>{it.unitPrice}</td>
              <td>{it.quantity}</td>
              <td>{it.mlCommission}</td>
              <td>{it.shippingCost}</td>
              <td>{it.adsCostAllocated.toFixed(2)}</td>
              <td className={it.costApplied === null ? "missing-cost" : undefined}>
                {it.costApplied ?? "Sin costo"}
              </td>
              <td>{it.netProfit === null ? "-" : it.netProfit.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
