"use client";

import { useEffect, useState } from "react";
import { NoAccountState } from "../NoAccountState";
import { PeriodBar } from "../PeriodBar";
import { Period, rangeForPeriod, toDateStr } from "@/lib/period";

interface TrendRow {
  id: string;
  title: string;
  thumbnail: string | null;
  recentUnits: number;
  previousUnits: number;
  recentRate: number;
  previousRate: number;
  /** null = no vendía nada antes: es un producto que arranca. */
  changePct: number | null;
}

function rate(n: number) {
  // Unidades por día suele ser < 1; expresarlo por semana se lee mucho mejor.
  return `${(n * 7).toLocaleString("es-AR", { maximumFractionDigits: 1 })} /sem`;
}

function TrendList({
  title,
  hint,
  rows,
  tone,
  empty,
}: {
  title: string;
  hint: string;
  rows: TrendRow[];
  tone: "up" | "down";
  empty: string;
}) {
  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <h3 className="chart-card-title">{title}</h3>
        <span className="field-hint" style={{ margin: 0 }}>{hint}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state" style={{ padding: "var(--space-5) var(--space-3)" }}>{empty}</div>
      ) : (
        <ul className="top-products">
          {rows.map((r) => (
            <li className="top-product" key={r.id}>
              {r.thumbnail ? (
                <img className="top-product-img" src={r.thumbnail} alt="" loading="lazy" />
              ) : (
                <span className="top-product-img" aria-hidden="true" />
              )}
              <span className="top-product-main">
                <span className="top-product-name" title={r.title}>{r.title}</span>
                <span className="top-product-meta">
                  {rate(r.previousRate)} → {rate(r.recentRate)}
                </span>
              </span>
              <span className="top-product-side">
                <span className={`delta-pill ${tone}`}>
                  {r.changePct === null
                    ? "Nuevo"
                    : `${tone === "up" ? "↑" : "↓"} ${Math.abs(r.changePct * 100).toLocaleString("es-AR", { maximumFractionDigits: 0 })}%`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TendenciasPage() {
  const [rows, setRows] = useState<TrendRow[] | null>(null);
  const [period, setPeriod] = useState<Period>("trimestre");
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [noAccount, setNoAccount] = useState(false);

  const { from, to } = rangeForPeriod(period, customFrom, customTo);

  useEffect(() => {
    setRows(null);
    fetch(`/api/summary?groupBy=trend&from=${from}&to=${to}`)
      .then(async (r) => {
        if (r.status === 401) { setNoAccount(true); return; }
        setRows(await r.json());
      })
      .catch(() => setRows([]));
  }, [from, to]);

  if (noAccount) {
    return (
      <div>
        <h1>Tendencias</h1>
        <NoAccountState />
      </div>
    );
  }

  // Un producto "sube" o "baja" por su ritmo de venta, no por el total: si no,
  // cualquier producto viejo con mucho acumulado taparía al que está
  // despegando ahora.
  const subiendo = (rows ?? [])
    .filter((r) => r.recentRate > r.previousRate && r.recentUnits > 0)
    .sort((a, b) => b.recentRate - b.previousRate - (a.recentRate - a.previousRate))
    .slice(0, 5);

  const bajando = (rows ?? [])
    .filter((r) => r.recentRate < r.previousRate && r.previousUnits > 0)
    .sort((a, b) => a.recentRate - a.previousRate - (b.recentRate - b.previousRate))
    .slice(0, 5);

  return (
    <div>
      <h1>Tendencias</h1>
      <p className="field-hint" style={{ marginBottom: "var(--space-3)", maxWidth: "70ch" }}>
        Qué productos están agarrando ritmo y cuáles se están apagando. Se compara la segunda mitad del período
        elegido contra la primera, midiendo <strong>unidades por semana</strong> y no el total acumulado.
      </p>

      <PeriodBar
        period={period}
        onPeriodChange={setPeriod}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />

      {rows === null ? (
        <p className="empty-state">Cargando tendencias…</p>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p style={{ margin: 0, fontWeight: 600, color: "var(--text)" }}>Sin ventas en este período.</p>
          <p style={{ margin: "var(--space-2) 0 0" }}>Probá con un período más largo — &quot;Este trimestre&quot; o &quot;Este año&quot;.</p>
        </div>
      ) : (
        <div className="chart-split-even">
          <TrendList
            title="Están despegando"
            hint="Venden más rápido que antes"
            rows={subiendo}
            tone="up"
            empty="Ningún producto aceleró en este período."
          />
          <TrendList
            title="Se están apagando"
            hint="Venden más lento que antes"
            rows={bajando}
            tone="down"
            empty="Ningún producto se desaceleró en este período."
          />
        </div>
      )}
    </div>
  );
}
