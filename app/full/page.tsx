"use client";

import { useEffect, useState } from "react";
import { NoAccountState } from "../NoAccountState";
import { PeriodBar } from "../PeriodBar";
import { Period, rangeForPeriod, toDateStr } from "@/lib/period";

interface FullProduct {
  id: string;
  title: string;
  thumbnail: string | null;
  availableQty: number;
  unavailableQty: number;
  fullStockValue: number | null;
  daysInFull: number | null;
  oldStockRisk: boolean;
  lowStockThreshold: number | null;
  lowStock: boolean;
  unitsSoldRecent: number;
  rotationDays: number | null;
  daysUntilStockout: number | null;
}

interface FullCost {
  detail: string;
  label: string;
  amount: number;
}

interface FullData {
  available: boolean;
  oldStockDaysThreshold?: number;
  salesVelocityDays?: number;
  products?: FullProduct[];
  totals?: { capital: number; productos: number; conStockBajo: number; conRiesgoStockAntiguo: number };
  costs?: FullCost[];
  costsAvailable?: boolean;
}

function fmt(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

function KpiValue({ children }: { children: React.ReactNode }) {
  if (children === "-") return <span className="skeleton" aria-hidden="true" />;
  return <>{children}</>;
}

function diasLabel(n: number | null) {
  if (n === null) return "Sin ventas recientes";
  if (n < 1) return "Menos de 1 día";
  return `${Math.round(n)} día(s)`;
}

export default function FullPage() {
  const [data, setData] = useState<FullData | null>(null);
  const [period, setPeriod] = useState<Period>("mes");
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [noAccount, setNoAccount] = useState(false);
  const [loadError, setLoadError] = useState("");

  const { from, to } = rangeForPeriod(period, customFrom, customTo);

  function load() {
    setLoadError("");
    fetch(`/api/full?from=${from}&to=${to}`)
      .then(async (r) => {
        if (r.status === 401) { setNoAccount(true); return; }
        if (!r.ok) throw new Error(String(r.status));
        setData(await r.json());
      })
      .catch(() => {
        setLoadError("No se pudo cargar la información de Full. Probá recargar la página.");
        setData({ available: false });
      });
  }

  useEffect(load, [from, to]);

  if (noAccount) {
    return (
      <div>
        <h1>Full</h1>
        <NoAccountState />
      </div>
    );
  }

  return (
    <div>
      <h1>Full</h1>
      <p className="field-hint" style={{ marginBottom: "var(--space-3)" }}>
        Stock guardado en Mercado Envíos Full, su valor, cuánto te cuesta tenerlo ahí y cuánto te queda antes de
        agotarlo.
      </p>
      {loadError && <p className="field-error" role="alert" style={{ marginBottom: "var(--space-3)" }}>{loadError}</p>}

      {data && data.available === false ? (
        <div className="empty-state">
          <p style={{ margin: 0, fontWeight: 600, color: "var(--text)" }}>Todavía no está lista esta pantalla.</p>
          <p style={{ margin: "var(--space-2) 0 0" }}>
            Falta correr la migración <code>db/postgres/migrations/013-full-logistica.sql</code> (y sincronizar
            después).
          </p>
        </div>
      ) : (
        <>
          <PeriodBar
            period={period}
            onPeriodChange={setPeriod}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
          />

          <h2 className="section-title">Stock en Full</h2>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="label">Capital inmovilizado</div>
              <div className="value"><KpiValue>{data ? fmt(data.totals?.capital ?? 0) : "-"}</KpiValue></div>
            </div>
            <div className="kpi-card">
              <div className="label">Productos en Full</div>
              <div className="value"><KpiValue>{data ? String(data.totals?.productos ?? 0) : "-"}</KpiValue></div>
            </div>
            <div className="kpi-card">
              <div className="label">Con stock bajo</div>
              <div className="value"><KpiValue>{data ? String(data.totals?.conStockBajo ?? 0) : "-"}</KpiValue></div>
            </div>
            <div className="kpi-card">
              <div className="label">Riesgo de stock antiguo</div>
              <div className="value"><KpiValue>{data ? String(data.totals?.conRiesgoStockAntiguo ?? 0) : "-"}</KpiValue></div>
            </div>
          </div>

          <h2 className="section-title">Costos de Full en el período</h2>
          {!data ? (
            <p className="empty-state">Cargando…</p>
          ) : !data.costsAvailable ? (
            <div className="empty-state">
              <p style={{ margin: 0 }}>Falta la migración de facturación para ver este detalle.</p>
            </div>
          ) : data.costs && data.costs.length === 0 ? (
            <div className="empty-state">
              <p style={{ margin: 0 }}>Sin cargos de Full en este período.</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ marginBottom: "var(--space-5)" }}>
              <table>
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th className="num">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {data.costs?.map((c) => (
                    <tr key={c.detail}>
                      <td>{c.label}</td>
                      <td className="num">{fmt(c.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ fontWeight: 600 }}>Total</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {fmt((data.costs ?? []).reduce((sum, c) => sum + c.amount, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <h2 className="section-title">Stock por producto</h2>
          {data && data.products && data.products.length === 0 ? (
            <div className="empty-state">
              <p style={{ margin: 0, fontWeight: 600, color: "var(--text)" }}>No tenés productos en Full.</p>
            </div>
          ) : (
            <div className="table-wrap table-scroll table-compact">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Disponible</th>
                    <th className="num">No disponible</th>
                    <th className="num">Valor</th>
                    <th className="num">Antigüedad en Full</th>
                    <th className="num">Rotación</th>
                    <th className="num">Previsión de agotamiento</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.products?.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="cell-product">
                          {p.thumbnail ? (
                            <img className="cell-thumb" src={p.thumbnail} alt="" loading="lazy" />
                          ) : (
                            <span className="cell-thumb" aria-hidden="true" />
                          )}
                          <span style={{ minWidth: 0 }}>
                            <span className="cell-title" title={p.title}>{p.title}</span>
                          </span>
                        </span>
                      </td>
                      <td className={`num ${p.lowStock ? "missing-cost" : ""}`}>{p.availableQty}</td>
                      <td className="num">{p.unavailableQty}</td>
                      <td className="num">{p.fullStockValue === null ? "—" : fmt(p.fullStockValue)}</td>
                      <td className={`num ${p.oldStockRisk ? "missing-cost" : ""}`}>
                        {p.daysInFull === null ? "—" : `${p.daysInFull} día(s)`}
                        {p.oldStockRisk && (
                          <>
                            {" "}
                            <span className="badge badge-cancelled">+{data?.oldStockDaysThreshold}</span>
                          </>
                        )}
                      </td>
                      <td className="num">{p.rotationDays === null ? "—" : diasLabel(p.rotationDays)}</td>
                      <td className="num">{p.daysUntilStockout === null ? "—" : diasLabel(p.daysUntilStockout)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details className="explain-box">
            <summary>¿De dónde salen estos números?</summary>
            <ul>
              <li>
                <strong>Valor</strong>: cantidad guardada en Full (disponible + no disponible: dañado, en
                revisión, en tránsito) × el último costo que cargaste en Productos.
              </li>
              <li>
                <strong>Antigüedad en Full</strong>: desde la primera vez que este dashboard vio el producto con
                stock en Full — Mercado Libre no expone la fecha real de ingreso al depósito por su API, así que
                si el producto ya estaba en Full antes de usar esta pantalla, la antigüedad real es mayor.
              </li>
              <li>
                <strong>Riesgo de stock antiguo</strong>: Mercado Libre cobra un cargo extra por productos que
                llevan mucho tiempo guardados sin venderse. El umbral que usamos ({data?.oldStockDaysThreshold ?? 120}{" "}
                días) sale de investigar públicamente cómo funciona Full, no es un dato que ML confirme por API —
                puede variar según categoría.
              </li>
              <li>
                <strong>Rotación y previsión de agotamiento</strong>: se calculan con las unidades vendidas en los
                últimos {data?.salesVelocityDays ?? 30} días. Rotación es cada cuántos días se vendió una unidad en
                promedio; previsión de agotamiento es, a ese ritmo, cuántos días de stock disponible quedan. Sin
                ventas en esa ventana, no se puede estimar ninguna de las dos.
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
