"use client";

import { useEffect, useState } from "react";
import { SyncButton } from "./SyncButton";

interface Summary {
  orders: number;
  grossSales: number;
  aov: number;
  netProfit: number;
  profitPct: number;
  netRevenue: number;
  adSpend: number;
  mer: number;
  roas: number;
  cpa: number;
  netAov: number;
  trueCpa: number;
  itemsMissingCost: number;
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

interface OrderSummaryRow {
  orderId: string;
  estadoPago: string;
  dateCreated: string;
  totalOrder: number;
  totalNeto: number;
}

function fmt(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}
function pct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

type Period = "hoy" | "ayer" | "semana" | "mes" | "custom";

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function rangeForPeriod(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date();
  if (period === "hoy") {
    const d = toDateStr(today);
    return { from: d, to: d };
  }
  if (period === "ayer") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const d = toDateStr(yesterday);
    return { from: d, to: d };
  }
  if (period === "semana") {
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    return { from: toDateStr(weekAgo), to: toDateStr(today) };
  }
  if (period === "mes") {
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toDateStr(firstOfMonth), to: toDateStr(today) };
  }
  return { from: customFrom, to: customTo };
}

function WaterfallRow({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "negative" | "positive";
}) {
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

function KpiValue({ children }: { children: React.ReactNode }) {
  if (children === "-") return <span className="skeleton" aria-hidden="true" />;
  return <>{children}</>;
}

export default function HomePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastOrder, setLastOrder] = useState<OrderLine | null>(null);
  const [orders, setOrders] = useState<OrderSummaryRow[] | null>(null);
  const [adForm, setAdForm] = useState({ channel: "meta", date: new Date().toISOString().slice(0, 10), amount: "" });
  const [adFormError, setAdFormError] = useState("");
  const [adFormSuccess, setAdFormSuccess] = useState(false);
  const [period, setPeriod] = useState<Period>("mes");
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [mlConnected, setMlConnected] = useState<boolean | null>(null);

  const { from, to } = rangeForPeriod(period, customFrom, customTo);

  function loadAll() {
    fetch(`/api/summary?from=${from}&to=${to}`).then((r) => r.json()).then(setSummary);
    fetch("/api/orders").then((r) => r.json()).then((rows: OrderLine[]) => setLastOrder(rows[0] ?? null));
    fetch("/api/orders?groupBy=order").then((r) => r.json()).then(setOrders);
  }

  useEffect(loadAll, [from, to]);
  useEffect(() => {
    fetch("/api/account/me")
      .then((r) => r.json())
      .then((data) => setMlConnected(Boolean(data.mlConnected)));
  }, []);

  async function submitAdSpend(e: React.FormEvent) {
    e.preventDefault();
    setAdFormError("");
    setAdFormSuccess(false);
    const amount = Number(adForm.amount);
    if (adForm.amount.trim() === "" || Number.isNaN(amount) || amount < 0) {
      setAdFormError("Ingresá un monto válido (mayor o igual a 0).");
      return;
    }
    await fetch("/api/ads-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: adForm.channel, date: adForm.date, amount }),
    });
    setAdForm((prev) => ({ ...prev, amount: "" }));
    setAdFormSuccess(true);
    loadAll();
  }

  return (
    <div>
      <h1>Resumen de cuenta</h1>
      {mlConnected === false && (
        <p className="missing-cost">
          Todavía no conectaste Mercado Libre. <a href="/api/ml/login">Conectar ahora</a>
        </p>
      )}
      <SyncButton />

      <div className="ad-form" style={{ marginBottom: 24 }}>
        <label>
          Período
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            <option value="hoy">Hoy</option>
            <option value="ayer">Ayer</option>
            <option value="semana">Últimos 7 días</option>
            <option value="mes">Este mes</option>
            <option value="custom">Rango custom</option>
          </select>
        </label>
        {period === "custom" && (
          <>
            <label>
              Desde
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label>
              Hasta
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </>
        )}
      </div>

      <h2 className="section-title">Tienda</h2>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="label">Orders</div><div className="value"><KpiValue>{summary?.orders ?? "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Revenue</div><div className="value"><KpiValue>{summary ? fmt(summary.grossSales) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">AOV</div><div className="value"><KpiValue>{summary ? fmt(summary.aov) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Net Profit</div><div className="value"><KpiValue>{summary ? fmt(summary.netProfit) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Profit %</div><div className="value"><KpiValue>{summary ? pct(summary.profitPct) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Net Rev.</div><div className="value"><KpiValue>{summary ? fmt(summary.netRevenue) : "-"}</KpiValue></div></div>
      </div>

      <h2 className="section-title">Anuncios</h2>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="label">Ad Spend</div><div className="value"><KpiValue>{summary ? fmt(summary.adSpend) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">MER</div><div className="value"><KpiValue>{summary ? summary.mer.toFixed(2) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">ROAS</div><div className="value"><KpiValue>{summary ? summary.roas.toFixed(2) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">CPA</div><div className="value"><KpiValue>{summary ? fmt(summary.cpa) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Net AOV</div><div className="value"><KpiValue>{summary ? fmt(summary.netAov) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">True CPA</div><div className="value"><KpiValue>{summary ? fmt(summary.trueCpa) : "-"}</KpiValue></div></div>
      </div>
      {summary && summary.itemsMissingCost > 0 && (
        <p className="missing-cost">{summary.itemsMissingCost} línea(s) de venta sin costo cargado, excluidas de Net Profit</p>
      )}

      <h2 className="section-title">Cargar publicidad externa</h2>
      <form className="ad-form" onSubmit={submitAdSpend} noValidate>
        <label>
          Canal
          <select value={adForm.channel} onChange={(e) => setAdForm((p) => ({ ...p, channel: e.target.value }))}>
            <option value="meta">Meta</option>
            <option value="google">Google Ads</option>
            <option value="tiktok">TikTok</option>
          </select>
        </label>
        <label>
          Fecha
          <input type="date" value={adForm.date} onChange={(e) => setAdForm((p) => ({ ...p, date: e.target.value }))} />
        </label>
        <div className="field-group">
          <label htmlFor="ad-amount">Monto</label>
          <input
            id="ad-amount"
            type="number"
            min="0"
            inputMode="decimal"
            aria-invalid={adFormError ? true : undefined}
            value={adForm.amount}
            onChange={(e) => {
              setAdForm((p) => ({ ...p, amount: e.target.value }));
              if (adFormError) setAdFormError("");
            }}
          />
          {adFormError && <p className="field-error" role="alert">{adFormError}</p>}
        </div>
        <button type="submit" className="btn btn-primary">Cargar</button>
        {adFormSuccess && (
          <span role="status" aria-live="polite" className="success-text">
            Publicidad cargada.
          </span>
        )}
      </form>

      {lastOrder && (
        <>
          <h2 className="section-title">Última venta · {lastOrder.productTitle}</h2>
          <div className="waterfall-card">
            <WaterfallRow
              label="Facturación"
              value={lastOrder.unitPrice * lastOrder.quantity}
              max={lastOrder.unitPrice * lastOrder.quantity}
              tone="positive"
            />
            <WaterfallRow label="Comisión ML" value={lastOrder.mlCommission} max={lastOrder.unitPrice * lastOrder.quantity} tone="negative" />
            <WaterfallRow label="Envío" value={lastOrder.shippingCost} max={lastOrder.unitPrice * lastOrder.quantity} tone="negative" />
            <WaterfallRow label="Publicidad" value={lastOrder.adsCostAllocated} max={lastOrder.unitPrice * lastOrder.quantity} tone="negative" />
            <WaterfallRow
              label="Costo"
              value={(lastOrder.costApplied ?? 0) * lastOrder.quantity}
              max={lastOrder.unitPrice * lastOrder.quantity}
              tone="negative"
            />
            <WaterfallRow label="Ganancia neta" value={lastOrder.netProfit ?? 0} max={lastOrder.unitPrice * lastOrder.quantity} tone="positive" />
          </div>
        </>
      )}

      <h2 className="section-title">Últimas órdenes</h2>
      {orders && orders.length === 0 ? (
        <div className="empty-state">Todavía no hay órdenes sincronizadas para este período.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order Id</th>
                <th>Estado Pago</th>
                <th>Created at</th>
                <th className="num">Total Order</th>
                <th className="num">Total Neto</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={o.orderId}>
                  <td>{o.orderId}</td>
                  <td>
                    <span className={`badge ${o.estadoPago === "paid" ? "badge-paid" : "badge-other"}`}>{o.estadoPago}</span>
                  </td>
                  <td>{new Date(o.dateCreated).toLocaleString("es-AR")}</td>
                  <td className="num">{fmt(o.totalOrder)}</td>
                  <td className="num">{fmt(o.totalNeto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
