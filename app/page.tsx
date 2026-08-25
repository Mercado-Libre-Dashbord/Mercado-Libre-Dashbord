"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";
import { SyncButton } from "./SyncButton";
import { NoAccountState } from "./NoAccountState";
import { Period, PERIOD_OPTIONS, rangeForPeriod, toDateStr } from "@/lib/period";

interface PreviousTotals {
  orders: number;
  grossSales: number;
  netProfit: number;
  profitPct: number;
}

interface Summary {
  orders: number;
  grossSales: number;
  aov: number;
  netProfit: number;
  profitPct: number;
  netRevenue: number;
  itemsMissingCost: number;
  previous: PreviousTotals | null;
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

interface ProductRow {
  id: string;
  title: string;
  unitsSold: number;
  totalProfit: number;
  marginPct: number | null;
}

function fmt(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}
function pct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

const ESTADO_LABEL: Record<string, string> = { paid: "Pagado", cancelled: "Cancelado", pending: "Pendiente" };
function estadoLabel(estado: string) {
  return ESTADO_LABEL[estado] ?? estado;
}
function estadoBadgeClass(estado: string) {
  if (estado === "paid") return "badge-paid";
  if (estado === "cancelled") return "badge-cancelled";
  return "badge-other";
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

const KPI_ICON_PATHS: Record<string, React.ReactNode> = {
  orders: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2.5 3h2.5l2.3 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21.5 7H6" />
    </>
  ),
  gross: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  aov: (
    <>
      <path d="M6 2v20l2-1.5L10 22l2-1.5L14 22l2-1.5L18 22V2H6z" />
      <path d="M9 7h6M9 11h6" />
    </>
  ),
  profit: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  margin: (
    <>
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
      <path d="M18 6 6 18" />
    </>
  ),
  net: (
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2" />
      <path d="M2.5 10h19M16 14.5h3" />
    </>
  ),
};

function KpiIcon({ name }: { name: string }) {
  return (
    <span className="kpi-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {KPI_ICON_PATHS[name]}
      </svg>
    </span>
  );
}

function DeltaPill({ current, previous }: { current: number; previous: number | null | undefined }) {
  if (previous === null || previous === undefined || previous <= 0) return null;
  const change = (current - previous) / previous;
  if (!Number.isFinite(change)) return null;
  const up = change >= 0;
  return (
    <span className={`delta-pill ${up ? "up" : "down"}`}>
      {up ? "↑" : "↓"} {Math.abs(change * 100).toFixed(1)}% vs. período anterior
    </span>
  );
}

export default function HomePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastOrder, setLastOrder] = useState<OrderLine | null>(null);
  const [orders, setOrders] = useState<OrderSummaryRow[] | null>(null);
  const [daily, setDaily] = useState<DailyBreakdown[] | null>(null);
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [period, setPeriod] = useState<Period>("hoy");
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [mlConnected, setMlConnected] = useState<boolean | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [loadError, setLoadError] = useState("");

  const { from, to } = rangeForPeriod(period, customFrom, customTo);

  // Si una llamada falla (red caída, error del servidor, etc.) esto evita que
  // la sección se quede en "Cargando…" para siempre: se resuelve al valor de
  // respaldo y se muestra un aviso arriba.
  function safeFetch<T>(url: string, onSuccess: (data: T) => void, fallback: T) {
    fetch(url)
      .then(async (r) => {
        if (r.status === 401) { setNoAccount(true); return; }
        if (!r.ok) throw new Error(`${r.status}`);
        onSuccess((await r.json()) as T);
      })
      .catch(() => {
        setLoadError("Algunos datos no se pudieron cargar. Probá recargar la página.");
        onSuccess(fallback);
      });
  }

  function loadAll() {
    setLoadError("");
    safeFetch<Summary | null>(`/api/summary?from=${from}&to=${to}`, setSummary, null);
    safeFetch<DailyBreakdown[]>(`/api/summary?groupBy=day&from=${from}&to=${to}`, setDaily, []);
    safeFetch<OrderLine[]>(`/api/orders?from=${from}&to=${to}`, (rows) => setLastOrder(rows[0] ?? null), []);
    safeFetch<OrderSummaryRow[]>(`/api/orders?groupBy=order&from=${from}&to=${to}`, setOrders, []);
    safeFetch<ProductRow[]>(`/api/products?from=${from}&to=${to}`, setProducts, []);
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
      {loadError && <p className="field-error" role="alert">{loadError}</p>}
      <SyncButton />

      <div className="ad-form" style={{ marginBottom: 24 }}>
        <label>
          Período
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
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
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="orders" /><span className="label">Órdenes</span></div>
          <div className="value"><KpiValue>{summary?.orders ?? "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.orders} previous={summary.previous?.orders} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="gross" /><span className="label">Facturación</span></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.grossSales) : "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.grossSales} previous={summary.previous?.grossSales} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="aov" /><span className="label">Ticket promedio</span></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.aov) : "-"}</KpiValue></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="profit" /><span className="label">Ganancia neta</span></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.netProfit) : "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.netProfit} previous={summary.previous?.netProfit} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="margin" /><span className="label">Margen neto</span></div>
          <div className="value"><KpiValue>{summary ? pct(summary.profitPct) : "-"}</KpiValue></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="net" /><span className="label">Facturación neta</span></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.netRevenue) : "-"}</KpiValue></div>
        </div>
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

      <h2 className="section-title">Top productos por ganancia</h2>
      {products === null ? (
        <p className="empty-state">Cargando productos…</p>
      ) : (() => {
        const top = [...products].filter((p) => p.unitsSold > 0).sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 5);
        return top.length === 0 ? (
          <div className="empty-state">Todavía no hay ventas en este período.</div>
        ) : (
          <div className="table-wrap" style={{ marginBottom: "var(--space-3)" }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Producto</th>
                  <th className="num">Unidades vendidas</th>
                  <th className="num">Margen %</th>
                  <th className="num">Ganancia neta</th>
                </tr>
              </thead>
              <tbody>
                {top.map((p, i) => (
                  <tr key={p.id}>
                    <td><span className="rank-badge">{i + 1}</span></td>
                    <td>{p.title}</td>
                    <td className="num">{p.unitsSold}</td>
                    <td className="num">{p.marginPct === null ? "-" : pct(p.marginPct)}</td>
                    <td className="num" style={{ color: p.totalProfit >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmt(p.totalProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}
      <details className="explain-box">
        <summary>¿Qué muestra esta tabla?</summary>
        <p>
          Tus 5 productos con más ganancia neta real en el período elegido (ya descontando comisión, envío,
          publicidad, costo e impuestos) — no solo los más vendidos. Un producto puede vender mucho y dejar poca
          plata, o vender poco y ser el más rentable: esta tabla te muestra cuál es cuál.
        </p>
      </details>

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
        <div className="table-wrap orders-table">
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
                  <td className="order-id">{o.orderId}</td>
                  <td>
                    <span className={`badge ${estadoBadgeClass(o.estadoPago)}`}>{estadoLabel(o.estadoPago)}</span>
                  </td>
                  <td>{new Date(o.dateCreated).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="num">{fmt(o.totalOrder)}</td>
                  <td className="num" style={{ color: o.totalNeto >= 0 ? "var(--positive)" : "var(--negative)", fontWeight: 600 }}>{fmt(o.totalNeto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
