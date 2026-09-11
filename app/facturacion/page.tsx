"use client";

import { useEffect, useState } from "react";
import { NoAccountState } from "../NoAccountState";
import { PeriodBar } from "../PeriodBar";
import { Period, rangeForPeriod, toDateStr } from "@/lib/period";
import { INVOICE_STATE_LABEL, type InvoiceState, type InvoiceStatus } from "@/lib/billing-alerts";
import { RECEIPT_WARNING_LABEL, type OrderReceipt } from "@/lib/order-receipt";

interface BillingHealthResponse {
  invoices: InvoiceStatus[];
  overdueAmount: number;
  dueSoonAmount: number;
  accruingAmount: number;
  alerts: InvoiceStatus[];
}

interface BillingStatus {
  health: BillingHealthResponse;
  restrictions: { confirmed: boolean; activeRestrictions: number | null };
}

interface BucketRow {
  bucket: string;
  label: string;
  amount: number;
}

interface BillingBreakdown {
  available: boolean;
  buckets: BucketRow[];
  total: number;
  creditNotes: { count: number; amount: number };
}

interface OrdersResponse {
  receipts: OrderReceipt[];
  negativeCount: number;
  negativeAmount: number;
  truncated: boolean;
}

type Tab = "deuda" | "operaciones" | "exportar";

const TABS: { id: Tab; label: string }[] = [
  { id: "deuda", label: "Estado de deuda" },
  { id: "operaciones", label: "Desglose por operación" },
  { id: "exportar", label: "Centro de exportación" },
];

function fmt(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

function pct(n: number) {
  return `${(n * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
}

/** El color de cada estado. Solo lo confirmado se pinta de verde. */
const STATE_BADGE: Record<InvoiceState, string> = {
  pagada: "badge-paid",
  por_vencer: "badge-other",
  vencida: "badge-cancelled",
  en_curso: "badge-other",
  cerrada_sin_fecha: "badge-other",
};

function InvoiceTimeline({ invoices }: { invoices: InvoiceStatus[] }) {
  if (invoices.length === 0) {
    return <p className="empty-state">Todavía no hay facturas de Mercado Libre sincronizadas.</p>;
  }
  return (
    <div className="table-wrap table-scroll">
      <table>
        <thead>
          <tr>
            <th>Período</th>
            <th className="num">Monto</th>
            <th>Vencimiento</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.key}>
              <td>{inv.dateFrom && inv.dateTo ? `${inv.dateFrom.slice(0, 10)} a ${inv.dateTo.slice(0, 10)}` : inv.key}</td>
              <td className="num">{fmt(inv.amount)}</td>
              <td>
                {/* Un vencimiento que ML no informó se dice, no se estima: una
                    fecha inventada se lee igual de firme que una real. */}
                {inv.dueDate ?? <span className="field-hint">No informado</span>}
              </td>
              <td>
                <span className={`badge ${STATE_BADGE[inv.state]}`}>{INVOICE_STATE_LABEL[inv.state]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DebtTab({ status }: { status: BillingStatus | null }) {
  if (!status) return <p className="empty-state">Cargando estado de facturación…</p>;
  const { health } = status;

  return (
    <>
      {health.alerts.length > 0 && (
        <div className="alert-stack" role="status">
          {health.alerts.map((alert) => (
            <p key={`${alert.key}-${alert.alert}`} className={`billing-alert ${alert.alert === "vencida" ? "urgent" : ""}`}>
              {alert.message}
            </p>
          ))}
        </div>
      )}

      <div className="kpi-grid kpi-grid-4">
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">Vencido</span></div>
          <div className="value">{fmt(health.overdueAmount)}</div>
          <div className="kpi-delta"><span className="kpi-delta-caption">Facturas pasadas de fecha</span></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">Por vencer</span></div>
          <div className="value">{fmt(health.dueSoonAmount)}</div>
          {/* Incluye las cerradas cuyo vencimiento ML no informó: son deuda
              que existe, y ponerlas en "vencido" sería afirmar una fecha que
              no tenemos. */}
          <div className="kpi-delta"><span className="kpi-delta-caption">Cerradas, sin vencer o sin fecha</span></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">Acumulando</span></div>
          <div className="value">{fmt(health.accruingAmount)}</div>
          {/* El período abierto NO es deuda: todavía suma cargos y el monto va
              a cambiar. Contarlo como deuda hace entrar en pánico al pedo. */}
          <div className="kpi-delta"><span className="kpi-delta-caption">Período en curso, todavía no facturado</span></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">Restricciones</span></div>
          <div className="value">
            {status.restrictions.confirmed ? String(status.restrictions.activeRestrictions ?? 0) : "—"}
          </div>
          <div className="kpi-delta">
            <span className="kpi-delta-caption">
              {status.restrictions.confirmed ? "Reportadas por Mercado Libre" : "No se pudo confirmar"}
            </span>
          </div>
        </div>
      </div>

      <h2 className="section-title">Facturas de Mercado Libre</h2>
      <InvoiceTimeline invoices={health.invoices} />

      <div className="day-card" style={{ marginTop: "var(--space-4)", maxWidth: 720 }}>
        <p className="field-hint" style={{ marginTop: 0 }}>
          Mercado Libre no expone por API si una factura está paga: lo que confirma es si el período está en curso o
          cerrado y por cuánto. Por eso acá una factura solo figura como <strong>Pagada</strong> cuando ML lo dice
          explícitamente. Si una aparece vencida y ya la pagaste, el saldo real está en tu cuenta de Mercado Pago.
        </p>
        <a className="btn btn-secondary btn-sm" href="https://www.mercadopago.com.ar/activities" target="_blank" rel="noopener noreferrer">
          Abrir Mercado Pago
        </a>
      </div>
    </>
  );
}

function ReceiptRow({ receipt }: { receipt: OrderReceipt }) {
  const [open, setOpen] = useState(false);
  const line = (label: string) => receipt.lines.find((l) => l.label === label)?.amount ?? 0;

  return (
    <>
      <tr className={receipt.warning === "margen_negativo" ? "row-negative" : undefined}>
        <td>{receipt.date}</td>
        <td>
          <button type="button" className="link-button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {receipt.orderId}
          </button>
        </td>
        <td className="num">{fmt(receipt.revenue)}</td>
        <td className="num">{fmt(line("Comisión de Mercado Libre"))}</td>
        <td className="num">{fmt(line("Costo de envío"))}</td>
        <td className="num">{fmt(line("IVA") + line("Otros impuestos"))}</td>
        <td className="num">
          {receipt.netMargin === null ? (
            <span className="field-hint">Sin costo</span>
          ) : (
            <strong className={receipt.netMargin < 0 ? "text-negative" : undefined}>{fmt(receipt.netMargin)}</strong>
          )}
        </td>
        <td className="num">{receipt.netMarginPct === null ? "—" : pct(receipt.netMarginPct)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="receipt-cell">
            {/* El recibo se lee como la cuenta que haría el vendedor a mano:
                de lo que pagó el comprador, qué se llevó cada uno. */}
            <ul className="receipt">
              {receipt.lines.map((l) => (
                <li key={l.label} className={l.kind === "ingreso" ? "receipt-in" : undefined}>
                  <span>{l.label}</span>
                  <span className="receipt-amount">
                    {l.kind === "costo" ? "− " : ""}
                    {fmt(l.amount)}
                    {l.kind === "costo" && <span className="receipt-share">{pct(l.share)}</span>}
                  </span>
                </li>
              ))}
              <li className="receipt-total">
                <span>Margen neto real</span>
                <span className="receipt-amount">
                  {receipt.netMargin === null ? "Falta cargar el costo" : fmt(receipt.netMargin)}
                </span>
              </li>
            </ul>
            {receipt.warning && <p className="billing-alert urgent">{RECEIPT_WARNING_LABEL[receipt.warning]}</p>}
            {receipt.reconciliation && receipt.reconciliation.difference !== 0 && (
              <p className="field-hint">
                Mercado Libre facturó {fmt(receipt.reconciliation.real)} por esta orden; la estimación del panel era{" "}
                {fmt(receipt.reconciliation.estimated)}. Diferencia: {fmt(receipt.reconciliation.difference)}.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function OperationsTab({
  breakdown,
  orders,
  onlyNegative,
  onToggleNegative,
}: {
  breakdown: BillingBreakdown | null;
  orders: OrdersResponse | null;
  onlyNegative: boolean;
  onToggleNegative: (v: boolean) => void;
}) {
  return (
    <>
      <h2 className="section-title">Lo que Mercado Libre cobró, por concepto</h2>
      {breakdown === null ? (
        <p className="empty-state">Cargando cargos…</p>
      ) : !breakdown.available ? (
        <p className="empty-state">
          Falta correr la migración de facturación para guardar los cargos que Mercado Libre factura.
        </p>
      ) : breakdown.buckets.length === 0 ? (
        <p className="empty-state">Todavía no hay cargos sincronizados para este período.</p>
      ) : (
        <>
          <div className="table-wrap" style={{ marginBottom: "var(--space-3)" }}>
            <table>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.buckets.map((b) => (
                  <tr key={b.bucket}>
                    <td>{b.label}</td>
                    <td className="num">{fmt(b.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="num">{fmt(breakdown.total)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
          {breakdown.creditNotes.count > 0 && (
            <p className="field-hint">
              Incluye {breakdown.creditNotes.count} nota(s) de crédito por {fmt(breakdown.creditNotes.amount)} —
              devoluciones donde Mercado Libre reintegró la comisión. Ya están restadas de los conceptos de arriba.
            </p>
          )}
        </>
      )}

      <h2 className="section-title">Rentabilidad real por venta</h2>
      {orders && orders.negativeCount > 0 && (
        <p className="billing-alert urgent">
          {orders.negativeCount} {orders.negativeCount === 1 ? "orden dejó" : "órdenes dejaron"} pérdida por{" "}
          {fmt(Math.abs(orders.negativeAmount))} en total: entre la comisión y el envío gratis, el margen quedó en
          negativo.
        </p>
      )}
      <label className="checkbox-row">
        <input type="checkbox" checked={onlyNegative} onChange={(e) => onToggleNegative(e.target.checked)} />
        Ver solo las órdenes con margen negativo
      </label>

      {orders === null ? (
        <p className="empty-state">Cargando ventas…</p>
      ) : orders.receipts.length === 0 ? (
        <p className="empty-state">
          {onlyNegative ? "Ninguna orden de este período dejó pérdida." : "Sin ventas en este período."}
        </p>
      ) : (
        <>
          <div className="table-wrap table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Orden</th>
                  <th className="num">Precio venta</th>
                  <th className="num">Comisión</th>
                  <th className="num">Envío</th>
                  <th className="num">Impuestos</th>
                  <th className="num">Ganancia limpia</th>
                  <th className="num">Margen</th>
                </tr>
              </thead>
              <tbody>
                {orders.receipts.map((r) => (
                  <ReceiptRow key={r.orderId} receipt={r} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="field-hint">
            Tocá el número de orden para ver el recibo completo.
            {orders.truncated && " Se muestran las 200 órdenes más recientes del período."}
          </p>
        </>
      )}
    </>
  );
}

function ExportTab({ from, to }: { from: string; to: string }) {
  return (
    <>
      <h2 className="section-title">Reportes para el contador</h2>
      <div className="export-grid">
        <div className="day-card">
          <h3 className="chart-card-title">Cargos de Mercado Libre</h3>
          <p className="field-hint">
            Todos los cargos del período clasificados por concepto —comisión, envío, impuestos, publicidad, costo
            financiero— con el número de orden al lado y las notas de crédito incluidas con su signo, para que la
            columna sume el saldo del período.
          </p>
          <a className="btn btn-secondary btn-sm" href={`/api/export/billing?from=${from}&to=${to}`}>
            Descargar CSV
          </a>
        </div>
        <div className="day-card">
          <h3 className="chart-card-title">Detalle de ventas</h3>
          <p className="field-hint">
            Línea por línea de lo que el panel usó para calcular la ganancia, incluidas las órdenes canceladas con su
            estado, para cruzarlo contra la contabilidad propia.
          </p>
          <a className="btn btn-secondary btn-sm" href={`/api/export/orders?from=${from}&to=${to}`}>
            Descargar CSV
          </a>
        </div>
      </div>

      <div className="day-card" style={{ marginTop: "var(--space-4)", maxWidth: 720 }}>
        <p className="field-hint" style={{ marginTop: 0 }}>
          <strong>Los PDF de las facturas se bajan de Mercado Libre.</strong> Su API de facturación devuelve el
          detalle de cargos —que es lo que se exporta acá— pero no expone el comprobante en PDF ni en XML, así que
          esos archivos hay que bajarlos desde Facturación en tu cuenta de Mercado Libre. Preferimos decirlo antes que
          poner un botón que falle.
        </p>
      </div>
    </>
  );
}

export default function FacturacionPage() {
  const [tab, setTab] = useState<Tab>("deuda");
  const [period, setPeriod] = useState<Period>("mes");
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [noAccount, setNoAccount] = useState(false);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [breakdown, setBreakdown] = useState<BillingBreakdown | null>(null);
  const [orders, setOrders] = useState<OrdersResponse | null>(null);
  const [onlyNegative, setOnlyNegative] = useState(false);

  const { from, to } = rangeForPeriod(period, customFrom, customTo);

  useEffect(() => {
    fetch("/api/billing/status").then(async (r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      // El estado de facturación depende de la API de ML y puede fallar por
      // permisos: que falle no tiene que dejar la página entera cargando.
      if (!r.ok) { setStatus({ health: { invoices: [], overdueAmount: 0, dueSoonAmount: 0, accruingAmount: 0, alerts: [] }, restrictions: { confirmed: false, activeRestrictions: null } }); return; }
      setStatus(await r.json());
    });
  }, []);

  useEffect(() => {
    setBreakdown(null);
    setOrders(null);
    fetch(`/api/billing?from=${from}&to=${to}`).then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then(setBreakdown);
    });
    fetch(`/api/billing/orders?from=${from}&to=${to}${onlyNegative ? "&filter=negativo" : ""}`).then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then(setOrders);
    });
  }, [from, to, onlyNegative]);

  if (noAccount) {
    return (
      <div>
        <h1>Facturación</h1>
        <NoAccountState />
      </div>
    );
  }

  return (
    <div>
      <h1>Facturación</h1>

      <div className="tab-bar" role="tablist" aria-label="Secciones de facturación">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab-btn${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* El estado de deuda es de la cuenta entera y no de un rango de fechas:
          mostrar el selector ahí sugeriría que filtra algo que no filtra. */}
      {tab !== "deuda" && (
        <PeriodBar
          period={period}
          onPeriodChange={setPeriod}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
        />
      )}

      {tab === "deuda" && <DebtTab status={status} />}
      {tab === "operaciones" && (
        <OperationsTab
          breakdown={breakdown}
          orders={orders}
          onlyNegative={onlyNegative}
          onToggleNegative={setOnlyNegative}
        />
      )}
      {tab === "exportar" && <ExportTab from={from} to={to} />}
    </div>
  );
}
