"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";
import { SyncButton } from "./SyncButton";
import { NoAccountState } from "./NoAccountState";

interface Summary {
  orders: number;
  grossSales: number;
  aov: number;
  netProfit: number;
  profitPct: number;
  netRevenue: number;
  itemsMissingCost: number;
}

interface DailyBreakdown {
  day: string;
  revenue: number;
  commission: number;
  shipping: number;
  tax: number;
  cost: number;
  netProfit: number;
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
  taxApplied: number | null;
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
  const [daily, setDaily] = useState<DailyBreakdown[] | null>(null);
  const [period, setPeriod] = useState<Period>("mes");
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [mlConnected, setMlConnected] = useState<boolean | null>(null);
  const [noAccount, setNoAccount] = useState(false);

  const { from, to } = rangeForPeriod(period, customFrom, customTo);

  function loadAll() {
    fetch(`/api/summary?from=${from}&to=${to}`).then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then(setSummary);
    });
    fetch(`/api/summary?groupBy=day&from=${from}&to=${to}`).then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then(setDaily);
    });
    fetch("/api/orders").then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then((rows: OrderLine[]) => setLastOrder(rows[0] ?? null));
    });
    fetch("/api/orders?groupBy=order").then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then(setOrders);
    });
  }

  useEffect(loadAll, [from, to]);
  useEffect(() => {
    fetch("/api/account/me").then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then((data) => setMlConnected(Boolean(data.mlConnected)));
    });
  }, []);

  if (noAccount) {
    return (
      <div>
        <h1>Resumen de cuenta</h1>
        <NoAccountState />
      </div>
    );
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
        <div className="kpi-card"><div className="label">Órdenes</div><div className="value"><KpiValue>{summary?.orders ?? "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Facturación</div><div className="value"><KpiValue>{summary ? fmt(summary.grossSales) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Ticket promedio</div><div className="value"><KpiValue>{summary ? fmt(summary.aov) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Ganancia neta</div><div className="value"><KpiValue>{summary ? fmt(summary.netProfit) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Margen neto</div><div className="value"><KpiValue>{summary ? pct(summary.profitPct) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Facturación neta</div><div className="value"><KpiValue>{summary ? fmt(summary.netRevenue) : "-"}</KpiValue></div></div>
      </div>

      <details className="explain-box">
        <summary>¿Cómo se calculan estos números?</summary>
        <ul>
          <li><strong>Órdenes</strong>: cantidad de órdenes con al menos una venta en el período elegido.</li>
          <li><strong>Facturación</strong>: suma de precio × cantidad de todo lo vendido, antes de descontar nada.</li>
          <li><strong>Ticket promedio</strong>: Facturación ÷ Órdenes.</li>
          <li><strong>Ganancia neta</strong>: Facturación − comisión de Mercado Libre − envío − publicidad − costo de producto − impuestos. Si a un producto le falta costo cargado, sus ventas quedan afuera de este número (no se inventa un valor).</li>
          <li><strong>Margen neto</strong>: Ganancia neta ÷ Facturación.</li>
          <li><strong>Facturación neta</strong>: Facturación − comisión de Mercado Libre − envío (sin restar costo de producto ni impuestos).</li>
        </ul>
      </details>

      {summary && summary.itemsMissingCost > 0 && (
        <p className="missing-cost">{summary.itemsMissingCost} línea(s) de venta sin costo cargado, excluidas de Ganancia neta</p>
      )}

      <h2 className="section-title">De qué está hecha tu facturación</h2>
      {daily === null ? (
        <p className="empty-state">Cargando gráfico…</p>
      ) : daily.length === 0 ? (
        <div className="empty-state">Todavía no hay ventas en este período para graficar.</div>
      ) : (
        <>
          <div
            style={{
              width: "100%",
              height: 320,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: 16,
              marginBottom: "var(--space-3)",
            }}
          >
            <ResponsiveContainer>
              <BarChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" stroke="var(--text-dim)" tick={{ fill: "var(--text-dim)", fontSize: 12 }} />
                <YAxis stroke="var(--text-dim)" tick={{ fill: "var(--text-dim)", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                  labelStyle={{ color: "var(--text-dim)" }}
                  formatter={(value: number) => fmt(value)}
                />
                <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 13, color: "var(--text-dim)" }} />
                <Bar dataKey="commission" name="Comisión ML" stackId="a" fill="var(--chart-commission)" />
                <Bar dataKey="shipping" name="Envío" stackId="a" fill="var(--chart-shipping)" />
                <Bar dataKey="tax" name="Impuestos" stackId="a" fill="var(--chart-tax)" />
                <Bar dataKey="cost" name="Costo de producto" stackId="a" fill="var(--chart-cost)" />
                <Bar dataKey="netProfit" name="Ganancia neta" stackId="a" fill="var(--positive)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="explain-box">
            <summary>¿Qué muestra este gráfico?</summary>
            <p>
              Cada barra es un día, y muestra en qué se fue tu facturación de ese día: cuánto se lo llevó la
              comisión de Mercado Libre, cuánto el envío, cuánto los impuestos que cargaste por producto, cuánto
              el costo del producto, y cuánto quedó como ganancia neta real. Los cuatro primeros componentes
              salen directo de lo que Mercado Libre cobra en cada venta y de lo que cargaste en Productos — nada
              es estimado.
            </p>
          </details>
        </>
      )}

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
            <WaterfallRow
              label="Impuestos"
              value={(lastOrder.taxApplied ?? 0) * lastOrder.quantity}
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
                <th>N° de orden</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th className="num">Total</th>
                <th className="num">Neto</th>
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
