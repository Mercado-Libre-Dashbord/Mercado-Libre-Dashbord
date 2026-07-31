"use client";

import { useEffect, useState } from "react";
import { NoAccountState } from "../NoAccountState";

interface Summary {
  orders: number;
  grossSales: number;
  netProfit: number;
  profitPct: number;
}

interface OrderLine {
  id: number;
  orderId: string;
  productTitle: string;
  unitPrice: number;
  quantity: number;
  mlCommission: number;
  shippingCost: number;
  adsCostAllocated: number;
  costApplied: number | null;
  netProfit: number | null;
}

type Tab = "hoy" | "ayer" | "mes";

function fmt(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}
function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}
function rangeFor(tab: Tab): { from: string; to: string } {
  const today = new Date();
  if (tab === "hoy") {
    const d = toDateStr(today);
    return { from: d, to: d };
  }
  if (tab === "ayer") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    const d = toDateStr(y);
    return { from: d, to: d };
  }
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: toDateStr(firstOfMonth), to: toDateStr(today) };
}
function yesterdayRange(): { from: string; to: string } {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const d = toDateStr(y);
  return { from: d, to: d };
}

function WaterfallRow({ label, value, max, tone }: { label: string; value: number; max: number; tone: "negative" | "positive" }) {
  const width = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="waterfall-row">
      <span>{label}</span>
      <div className="waterfall-track">
        <div className={`waterfall-fill ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <span style={{ textAlign: "right", color: tone === "negative" ? "var(--negative)" : "var(--positive)" }}>
        {tone === "negative" ? "-" : "+"}
        {fmt(Math.abs(value))}
      </span>
    </div>
  );
}

const TAB_LABEL: Record<Tab, string> = { hoy: "Hoy", ayer: "Ayer", mes: "Este mes" };
const TAB_TITLE: Record<Tab, string> = {
  hoy: "Tu ganancia de hoy",
  ayer: "Tu ganancia de ayer",
  mes: "Tu ganancia este mes",
};

export default function ResultadoDelDiaPage() {
  const [tab, setTab] = useState<Tab>("hoy");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [yesterdaySummary, setYesterdaySummary] = useState<Summary | null>(null);
  const [lastOrder, setLastOrder] = useState<OrderLine | null>(null);
  const [noAccount, setNoAccount] = useState(false);

  useEffect(() => {
    setSummary(null);
    const { from, to } = rangeFor(tab);
    fetch(`/api/summary?from=${from}&to=${to}`).then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then(setSummary);
    });
  }, [tab]);

  useEffect(() => {
    if (tab !== "hoy") return;
    const { from, to } = yesterdayRange();
    fetch(`/api/summary?from=${from}&to=${to}`).then((r) => {
      if (r.status === 401) return;
      r.json().then(setYesterdaySummary);
    });
  }, [tab]);

  useEffect(() => {
    fetch("/api/orders").then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then((rows: OrderLine[]) => setLastOrder(rows[0] ?? null));
    });
  }, []);

  if (noAccount) {
    return (
      <div>
        <h1>Resultado del día</h1>
        <NoAccountState />
      </div>
    );
  }

  const delta =
    tab === "hoy" && summary && yesterdaySummary && yesterdaySummary.netProfit !== 0
      ? ((summary.netProfit - yesterdaySummary.netProfit) / Math.abs(yesterdaySummary.netProfit)) * 100
      : null;

  return (
    <div>
      <div className="day-card">
        <div className="day-header">
          <span className="day-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h1 className="day-title">{TAB_TITLE[tab]}</h1>
        </div>

        <div className="day-tabs" role="tablist">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`day-tab${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        <div className="day-kpis">
          <div className="day-kpi">
            <div className="label">Ganancia neta</div>
            <div className="day-kpi-value positive">{summary ? fmt(summary.netProfit) : <span className="skeleton" />}</div>
            {delta !== null && (
              <div className={`delta-pill ${delta >= 0 ? "up" : "down"}`}>
                {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(0)}% vs ayer
              </div>
            )}
          </div>
          <div className="day-kpi">
            <div className="label">Facturación</div>
            <div className="day-kpi-value">{summary ? fmt(summary.grossSales) : <span className="skeleton" />}</div>
          </div>
          <div className="day-kpi">
            <div className="label">Margen</div>
            <div className="day-kpi-value">{summary ? `${(summary.profitPct * 100).toFixed(1)}%` : <span className="skeleton" />}</div>
          </div>
        </div>
      </div>

      {lastOrder && (
        <>
          <h2 className="section-title">Última venta · {lastOrder.productTitle}</h2>
          <div className="waterfall-card">
            <WaterfallRow label="Facturación" value={lastOrder.unitPrice * lastOrder.quantity} max={lastOrder.unitPrice * lastOrder.quantity} tone="positive" />
            <WaterfallRow label="Comisión ML" value={lastOrder.mlCommission} max={lastOrder.unitPrice * lastOrder.quantity} tone="negative" />
            <WaterfallRow label="Envío" value={lastOrder.shippingCost} max={lastOrder.unitPrice * lastOrder.quantity} tone="negative" />
            <WaterfallRow label="Publicidad" value={lastOrder.adsCostAllocated} max={lastOrder.unitPrice * lastOrder.quantity} tone="negative" />
            <WaterfallRow label="Costo" value={(lastOrder.costApplied ?? 0) * lastOrder.quantity} max={lastOrder.unitPrice * lastOrder.quantity} tone="negative" />
            <WaterfallRow label="Ganancia neta" value={lastOrder.netProfit ?? 0} max={lastOrder.unitPrice * lastOrder.quantity} tone="positive" />
          </div>
        </>
      )}

      {summary && summary.orders === 0 && (
        <div className="empty-state">Todavía no hay ventas sincronizadas para {TAB_LABEL[tab].toLowerCase()}.</div>
      )}
    </div>
  );
}
