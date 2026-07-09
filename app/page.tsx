"use client";

import { useEffect, useState } from "react";
import { SyncButton } from "./SyncButton";

interface Summary {
  grossSales: number;
  totalCommission: number;
  totalShipping: number;
  totalAds: number;
  totalCost: number;
  netProfit: number;
  itemsMissingCost: number;
}

function fmt(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

export default function HomePage() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetch("/api/summary")
      .then((r) => r.json())
      .then(setSummary);
  }, []);

  return (
    <div>
      <h1>Resumen de cuenta</h1>
      <SyncButton />
      {!summary ? (
        <p>Cargando...</p>
      ) : (
        <div className="kpi-grid">
          <div className="kpi-card"><div>Ventas brutas</div><div className="value">{fmt(summary.grossSales)}</div></div>
          <div className="kpi-card"><div>Comisión ML</div><div className="value">{fmt(summary.totalCommission)}</div></div>
          <div className="kpi-card"><div>Envío</div><div className="value">{fmt(summary.totalShipping)}</div></div>
          <div className="kpi-card"><div>Publicidad</div><div className="value">{fmt(summary.totalAds)}</div></div>
          <div className="kpi-card"><div>Costo productos</div><div className="value">{fmt(summary.totalCost)}</div></div>
          <div className="kpi-card"><div>Rentabilidad neta</div><div className="value">{fmt(summary.netProfit)}</div></div>
          {summary.itemsMissingCost > 0 && (
            <div className="kpi-card missing-cost">
              {summary.itemsMissingCost} línea(s) de venta sin costo cargado, excluidas del cálculo
            </div>
          )}
        </div>
      )}
    </div>
  );
}
