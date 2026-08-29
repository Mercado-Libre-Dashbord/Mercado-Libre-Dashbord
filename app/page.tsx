"use client";

import { useEffect, useState } from "react";
import {
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { SyncButton } from "./SyncButton";
import { NoAccountState } from "./NoAccountState";
import { PeriodBar } from "./PeriodBar";
import { Period, rangeForPeriod, toDateStr } from "@/lib/period";
import { countsAsRevenue } from "@/lib/order-status";

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
  productsMissingCost: { productId: string; title: string; units: number }[];
  refundOrders: number;
  refundAmount: number;
  refundRate: number;
  /** null = Mercado Libre no dio el dato; distinto de 0 visitas. */
  visits: number | null;
  conversionRate: number | null;
  totalIva: number;
  totalCommission: number;
  totalShipping: number;
  previous: PreviousTotals | null;
  /** SQL de migraciones pendientes — solo llega si sos admin. */
  pendingMigrations?: string[];
}

interface DailyBreakdown {
  day: string;
  revenue: number;
  commission: number;
  shipping: number;
  tax: number;
  iva: number;
  cost: number;
  netProfit: number;
}

interface BillingBucket {
  bucket: string;
  label: string;
  amount: number;
}

interface Billing {
  available: boolean;
  buckets: BillingBucket[];
  total: number;
  charges?: number;
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
  stock: number;
  thumbnail: string | null;
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
  refund: (
    <>
      <path d="M3 12a9 9 0 1 0 2.6-6.4" />
      <path d="M3 3v5h5" />
    </>
  ),
  visits: (
    <>
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

/** El ⓘ de cada tarjeta con la explicación de esa métrica. */
function KpiInfo({ children }: { children: React.ReactNode }) {
  return (
    <details className="kpi-info">
      <summary aria-label="Cómo se calcula">i</summary>
      <div className="kpi-info-panel">{children}</div>
    </details>
  );
}

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
  // El "vs. período anterior" va afuera de la píldora: adentro obligaba a la
  // píldora redondeada a partirse en dos líneas en las tarjetas angostas.
  return (
    <div className="kpi-delta">
      <span className={`delta-pill ${up ? "up" : "down"}`}>
        {up ? "↑" : "↓"} {Math.abs(change * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%
      </span>
      <span className="kpi-delta-caption">vs. período anterior</span>
    </div>
  );
}

const LAST_SALE_RAMP = [
  "var(--chart-commission)",
  "var(--chart-shipping)",
  "var(--chart-cost)",
  "var(--chart-iva)",
  "var(--chart-tax)",
];

/**
 * En qué se repartió la facturación del período: parte-de-un-todo con pocas
 * porciones, que es el caso en que una torta se lee de un vistazo. Los montos
 * y porcentajes van en la leyenda, porque comparar arcos parecidos a ojo no
 * funciona.
 *
 * Reemplaza al gráfico de barras apiladas que estaba abajo: los dos mostraban
 * la misma descomposición de la facturación, uno por día y otro agregado, y
 * la evolución en el tiempo ya la cubre "Rendimiento de ventas".
 */
function RevenueSplitPie({ daily }: { daily: DailyBreakdown[] }) {
  const totals = daily.reduce(
    (acc, d) => ({
      commission: acc.commission + d.commission,
      shipping: acc.shipping + d.shipping,
      tax: acc.tax + d.tax,
      iva: acc.iva + d.iva,
      cost: acc.cost + d.cost,
      netProfit: acc.netProfit + d.netProfit,
      revenue: acc.revenue + d.revenue,
    }),
    { commission: 0, shipping: 0, tax: 0, iva: 0, cost: 0, netProfit: 0, revenue: 0 }
  );

  const slices = [
    { name: "Comisión ML", value: totals.commission },
    { name: "Envío", value: totals.shipping },
    { name: "Costo de producto", value: totals.cost },
    { name: "IVA", value: totals.iva },
    { name: "Otros impuestos", value: totals.tax },
    { name: "Ganancia neta", value: totals.netProfit },
  ];
  const revenue = totals.revenue;
  const visible = slices.filter((s) => s.value > 0);
  if (visible.length === 0) return null;

  return (
    <div className="chart-card" style={{ marginBottom: 0 }}>
      <div className="chart-card-head">
        <h3 className="chart-card-title">En qué se fue tu facturación</h3>
      </div>
      <div style={{ width: "100%", height: 200, position: "relative" }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={visible}
              dataKey="value"
              nameKey="name"
              innerRadius="60%"
              outerRadius="90%"
              paddingAngle={2}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {visible.map((slice, i) => (
                <Cell
                  key={slice.name}
                  fill={slice.name === "Ganancia neta" ? "var(--positive)" : LAST_SALE_RAMP[i % LAST_SALE_RAMP.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
              formatter={(value: number, name: string) => [
                `${fmt(value)} · ${revenue > 0 ? ((value / revenue) * 100).toFixed(1) : "0"}%`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div
          aria-hidden="true"
          style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(revenue)}</span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>facturado</span>
        </div>
      </div>
      <ul className="donut-legend">
        {visible.map((slice, i) => (
          <li key={slice.name}>
            <span
              className="donut-swatch"
              style={{ background: slice.name === "Ganancia neta" ? "var(--positive)" : LAST_SALE_RAMP[i % LAST_SALE_RAMP.length] }}
            />
            <span className="donut-legend-name">{slice.name}</span>
            <span className="donut-legend-value">
              {revenue > 0 ? `${((slice.value / revenue) * 100).toFixed(0)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Los 5 productos que encabezan el período, en dos lecturas.
 *
 * "Más vendido" y "más rentable" casi nunca son el mismo producto, y ver las
 * dos listas es donde el vendedor toma decisiones. Antes eran dos bloques
 * separados —esta tarjeta y una tabla más abajo— que repetían las mismas
 * columnas; ahora es un solo lugar con un interruptor, así no hay que
 * comparar entre dos partes distintas de la página.
 *
 * La barra detrás de cada fila codifica la magnitud relativa al primero: el
 * orden se lee sin tener que comparar números.
 */
type TopMode = "vendidos" | "rentables";

function TopProductsCard({ rows }: { rows: ProductRow[] }) {
  const [mode, setMode] = useState<TopMode>("vendidos");

  const sold = rows.filter((p) => p.unitsSold > 0);
  const top =
    mode === "vendidos"
      ? [...sold].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 5)
      : [...sold].sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 5);

  // La escala arranca en el máximo del modo activo: la barra es proporción
  // dentro de este top, no contra toda la cuenta.
  const peak = Math.max(
    ...top.map((p) => (mode === "vendidos" ? p.unitsSold : Math.max(p.totalProfit, 0))),
    1
  );

  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <h3 className="chart-card-title">Top productos</h3>
        <div className="seg" role="group" aria-label="Ordenar el top">
          <button
            type="button"
            className={`seg-btn${mode === "vendidos" ? " active" : ""}`}
            aria-pressed={mode === "vendidos"}
            onClick={() => setMode("vendidos")}
          >
            Más vendidos
          </button>
          <button
            type="button"
            className={`seg-btn${mode === "rentables" ? " active" : ""}`}
            aria-pressed={mode === "rentables"}
            onClick={() => setMode("rentables")}
          >
            Más rentables
          </button>
        </div>
      </div>

      {top.length === 0 ? (
        <div className="empty-state" style={{ padding: "var(--space-5) var(--space-3)" }}>
          Sin ventas en este período.
        </div>
      ) : (
        <>
          <ol className="top-products">
            {top.map((p, i) => {
              const value = mode === "vendidos" ? p.unitsSold : p.totalProfit;
              const width = Math.max(2, (Math.max(value, 0) / peak) * 100);
              return (
                <li className="top-product" key={p.id}>
                  <span className="top-rank" aria-hidden="true">{i + 1}</span>
                  {p.thumbnail ? (
                    // <img> y no next/image: son URLs de mlstatic que cambian por
                    // cuenta, y no vale configurar dominios remotos para un thumb.
                    <img className="top-product-img" src={p.thumbnail} alt="" loading="lazy" />
                  ) : (
                    <span className="top-product-img" aria-hidden="true" />
                  )}
                  <span className="top-product-main">
                    <span className="top-product-name" title={p.title}>{p.title}</span>
                    <span className="top-product-bar" aria-hidden="true">
                      <span className="top-product-bar-fill" style={{ width: `${width}%` }} />
                    </span>
                    <span className="top-product-meta">
                      {p.unitsSold} vendidas ·{" "}
                      <span style={{ color: p.totalProfit >= 0 ? "var(--positive)" : "var(--negative)", fontWeight: 600 }}>
                        {fmt(p.totalProfit)}
                      </span>
                      {p.marginPct !== null && <> · {pct(p.marginPct)} de margen</>}
                    </span>
                  </span>
                  <span className="top-product-side">
                    <StockBadge stock={p.stock} />
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="chart-card-foot">
            {mode === "vendidos"
              ? "Ordenado por unidades. Fijate la ganancia: el que más vende no siempre es el que más deja."
              : "Ordenado por ganancia neta real, ya descontando comisión, envío, publicidad, costo e impuestos."}{" "}
            <a href="/productos">Ver todos</a>
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Qué productos le faltan por costear, no solo cuántas líneas.
 *
 * El aviso anterior decía "N líneas de venta sin costo cargado" y nada más.
 * Como el que más aparece acá suele ser una publicación que ya no está
 * activa, el vendedor cargaba todo lo que veía en la lista y el número no se
 * movía: parecía que la carga no tomaba.
 */
function MissingCostPanel({
  items,
  products,
}: {
  items: number;
  products: { productId: string; title: string; units: number }[];
}) {
  return (
    <div className="missing-cost-panel" role="status">
      <p className="missing-cost-head">
        <strong>{items} línea(s) de venta sin costo cargado.</strong> Sus ventas quedan fuera de la ganancia
        neta — no se estima un valor.
      </p>
      {products.length > 0 && (
        <ul className="missing-cost-list">
          {products.map((p) => (
            <li key={p.productId}>
              <span className="missing-cost-title" title={p.title}>{p.title}</span>
              <span className="missing-cost-units">{p.units} u.</span>
            </li>
          ))}
        </ul>
      )}
      <p className="missing-cost-foot">
        <a className="btn btn-secondary btn-sm" href="/productos">Cargar costos</a>
        <span>Si alguno ya no está publicado, igual aparece en Productos para que puedas costearlo.</span>
      </p>
    </div>
  );
}

const LOW_STOCK_THRESHOLD = 5;

function StockBadge({ stock }: { stock: number }) {
  const tone = stock <= 0 ? "out" : stock <= LOW_STOCK_THRESHOLD ? "low" : "ok";
  const label = stock <= 0 ? "Sin stock" : `${stock} en stock`;
  return (
    <span className={`stock-badge ${tone}`}>
      <span className="stock-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Ganancia contra costos día a día. La ganancia va en negro (la serie que
 * importa) y los costos en gris de contexto — resaltar una y apagar la otra
 * se lee mucho más rápido que dos colores compitiendo.
 */
function PerformanceChart({ daily }: { daily: DailyBreakdown[] }) {
  const data = daily.map((d) => ({
    day: d.day,
    ganancia: d.netProfit,
    costos: d.commission + d.shipping + d.tax + d.iva + d.cost,
  }));

  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <h3 className="chart-card-title">Rendimiento de ventas</h3>
        <span className="field-hint" style={{ margin: 0 }}>Ganancia neta vs. costos totales</span>
      </div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="day" stroke="var(--text-dim)" tick={{ fill: "var(--text-dim)", fontSize: 11 }} tickMargin={8} />
            <YAxis stroke="var(--text-dim)" tick={{ fill: "var(--text-dim)", fontSize: 11 }} width={54} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
              labelStyle={{ color: "var(--text-dim)" }}
              formatter={(value: number) => fmt(value)}
            />
            <Legend verticalAlign="top" align="left" wrapperStyle={{ fontSize: 12, color: "var(--text-dim)", paddingBottom: 8 }} />
            <Line type="monotone" dataKey="costos" name="Costos" stroke="var(--series-muted)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="ganancia" name="Ganancia neta" stroke="var(--series-strong)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<OrderSummaryRow[] | null>(null);
  const [daily, setDaily] = useState<DailyBreakdown[] | null>(null);
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
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
    safeFetch<OrderSummaryRow[]>(`/api/orders?groupBy=order&from=${from}&to=${to}`, setOrders, []);
    safeFetch<ProductRow[]>(`/api/products?from=${from}&to=${to}`, setProducts, []);
    safeFetch<Billing | null>(`/api/billing?from=${from}&to=${to}`, setBilling, null);
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
      {summary?.pendingMigrations && summary.pendingMigrations.length > 0 && (
        <div className="migration-banner" role="alert">
          <strong>Falta correr una migración en la base.</strong> Los impuestos por producto no se
          están guardando ni mostrando hasta que corras esto en el SQL Editor de Supabase:
          <pre>{summary.pendingMigrations.join("\n")}</pre>
        </div>
      )}
      <SyncButton />

      <PeriodBar
        period={period}
        onPeriodChange={setPeriod}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />

      <h2 className="section-title">Tienda</h2>
      <div className="kpi-grid">
        <div className="kpi-card kpi-hero">
          <div className="kpi-card-head"><KpiIcon name="gross" /><span className="label">Facturación</span><KpiInfo>Suma de precio × cantidad de todo lo vendido, antes de descontar nada. Las órdenes canceladas no cuentan.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.grossSales) : "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.grossSales} previous={summary.previous?.grossSales} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="orders" /><span className="label">Órdenes</span><KpiInfo>Cantidad de órdenes con al menos una venta en el período elegido, sin contar las canceladas.</KpiInfo></div>
          <div className="value"><KpiValue>{summary?.orders ?? "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.orders} previous={summary.previous?.orders} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="refund" /><span className="label">Devoluciones</span><KpiInfo>Plata de órdenes canceladas. No suma a la facturación ni a la ganancia —la venta se cayó— pero se muestra para que veas cuánto se te va por ahí.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.refundAmount) : "-"}</KpiValue></div>
          {summary && (
            <div className="kpi-delta">
              <span className="kpi-delta-caption">
                {summary.refundOrders} orden(es) · {(summary.refundRate * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}% de tus ventas
              </span>
            </div>
          )}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="aov" /><span className="label">Ticket promedio</span><KpiInfo>Facturación ÷ Órdenes. Cuánto gasta en promedio cada comprador.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.aov) : "-"}</KpiValue></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="profit" /><span className="label">Ganancia neta</span><KpiInfo>Facturación − comisión de Mercado Libre − envío − publicidad − costo del producto − IVA − otros impuestos. Si a un producto le falta el costo cargado, sus ventas quedan afuera de este número: no se inventa un valor.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.netProfit) : "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.netProfit} previous={summary.previous?.netProfit} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="margin" /><span className="label">Margen neto</span><KpiInfo>Ganancia neta ÷ Facturación. De cada $100 que facturás, cuánto te queda de verdad.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? pct(summary.profitPct) : "-"}</KpiValue></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><KpiIcon name="net" /><span className="label">Facturación neta</span><KpiInfo>Facturación − comisión de Mercado Libre − envío. No descuenta el costo del producto ni los impuestos.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.netRevenue) : "-"}</KpiValue></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head">
            <KpiIcon name="visits" /><span className="label">Visitas</span>
            <KpiInfo>
              Cuánta gente entró a ver tus publicaciones en el período, según Mercado Libre. Debajo va la
              conversión: de cada 100 visitas, cuántas terminaron en venta.
            </KpiInfo>
          </div>
          <div className="value">
            <KpiValue>
              {summary ? (summary.visits === null ? "Sin dato" : summary.visits.toLocaleString("es-AR")) : "-"}
            </KpiValue>
          </div>
          {summary?.conversionRate != null && (
            <div className="kpi-delta">
              <span className="kpi-delta-caption">
                {(summary.conversionRate * 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })}% de conversión
              </span>
            </div>
          )}
        </div>
      </div>

      {summary && summary.itemsMissingCost > 0 && (
        <MissingCostPanel
          items={summary.itemsMissingCost}
          products={summary.productsMissingCost ?? []}
        />
      )}

      <h2 className="section-title">Rendimiento</h2>
      {daily === null ? (
        <p className="empty-state">Cargando gráficos…</p>
      ) : daily.length === 0 ? (
        <div className="empty-state">
          <p style={{ margin: 0, fontWeight: 600, color: "var(--text)" }}>Sin ventas en este período.</p>
          <p style={{ margin: "var(--space-2) 0 0" }}>Probá con un período más largo — &quot;Este mes&quot; o &quot;Este año&quot;.</p>
        </div>
      ) : (
        <>
          <PerformanceChart daily={daily} />
          <div className="chart-split-even">
            <TopProductsCard rows={products ?? []} />
            <RevenueSplitPie daily={daily} />
          </div>
        </>
      )}


      {billing?.available && billing.buckets.length > 0 && (
        <>
          <h2 className="section-title">Lo que Mercado Libre te facturó</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th className="num">Importe</th>
                  <th className="num">Lo que calculamos</th>
                </tr>
              </thead>
              <tbody>
                {billing.buckets.map((b) => {
                  // Solo comisión y envío son comparables: son los dos cargos
                  // que la app también estima por orden.
                  const estimated =
                    b.bucket === "comision" ? summary?.totalCommission :
                    b.bucket === "envio" ? summary?.totalShipping : undefined;
                  return (
                    <tr key={b.bucket}>
                      <td>{b.label}</td>
                      <td className="num">{fmt(b.amount)}</td>
                      <td className="num" style={{ color: "var(--text-dim)" }}>
                        {estimated === undefined ? "—" : fmt(estimated)}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ fontWeight: 600 }}>Total facturado por ML</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmt(billing.total)}</td>
                  <td className="num">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <details className="explain-box">
            <summary>¿Qué es esta tabla?</summary>
            <p>
              Son los cargos <strong>reales</strong> de tu factura de Mercado Libre, traídos de su API de
              facturación: comisiones, envíos, percepciones impositivas y publicidad. El resto del dashboard
              estima estos costos venta por venta; acá ves lo que ML efectivamente te cobró, para poder
              comparar.
            </p>
            <p>
              Todavía <strong>no</strong> entran en la ganancia neta: la comisión y el envío ya se descuentan
              por orden, así que sumarlos otra vez los contaría dos veces. Si los números de las dos columnas
              no cierran, avisanos y ajustamos el cálculo.
            </p>
          </details>
        </>
      )}

      <h2 className="section-title">Últimas órdenes</h2>
      {orders && orders.length === 0 ? (
        <div className="empty-state">
          <p style={{ margin: 0, fontWeight: 600, color: "var(--text)" }}>Sin órdenes en este período.</p>
          <p style={{ margin: "var(--space-2) 0 0" }}>Cambiá el período de arriba o sincronizá para traer ventas nuevas.</p>
        </div>
      ) : (
        <div className="table-wrap table-scroll orders-table">
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
                  <td className="num" style={countsAsRevenue(o.estadoPago) ? undefined : { color: "var(--text-dim)", textDecoration: "line-through" }}>{fmt(o.totalOrder)}</td>
                  {/* Una orden cancelada no dejó ganancia: mostrar su neto en
                      verde como si fuera plata ganada era directamente falso. */}
                  <td className="num" style={countsAsRevenue(o.estadoPago) ? { color: o.totalNeto >= 0 ? "var(--positive)" : "var(--negative)", fontWeight: 600 } : { color: "var(--text-dim)" }}>
                    {countsAsRevenue(o.estadoPago) ? fmt(o.totalNeto) : "—"}
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
