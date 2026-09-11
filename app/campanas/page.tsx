"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer, Area, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { DeltaPill } from "../DeltaPill";
import { NoAccountState } from "../NoAccountState";
import { PeriodBar } from "../PeriodBar";
import { Period, rangeForPeriod, toDateStr } from "@/lib/period";

interface AdMetrics {
  adSpend: number;
  mer: number;
  roas: number;
  cpa: number;
  netAov: number;
  trueCpa: number;
  netProfit: number;
}

interface Summary extends AdMetrics {
  /** Mismo largo de días, inmediatamente antes del período elegido. */
  previous: AdMetrics | null;
}

interface DailyAdsRow {
  day: string;
  ads: number;
  revenue: number;
  netProfit: number;
}

interface ChannelSpend {
  channel: string;
  label: string;
  amount: number;
  attributed: boolean;
  share: number;
}

interface ChannelBreakdown {
  total: number;
  channels: ChannelSpend[];
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  budget: number;
}

function fmt(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

/**
 * Tooltip a medida: con el default de Recharts, un día sin ninguna venta
 * (esta app no rellena huecos) a veces mostraba la fecha sin ninguna fila de
 * detalle abajo — mismo problema que en el gráfico de facturación diaria del
 * Resumen. Se arma a mano para garantizar que siempre se vean las dos series.
 */
/** El color de la muestra del tooltip tiene que ser el mismo que el de la
 * serie en el gráfico; si no, la referencia no sirve para leerlo. */
const SERIES_COLOR: Record<string, string> = {
  ads: "var(--chart-ads)",
  revenue: "var(--accent-strong)",
  netProfit: "var(--positive)",
};

function AdsProfitTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
        padding: "8px 12px", fontSize: 12, minWidth: 180,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "2px 0" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text)" }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: SERIES_COLOR[p.dataKey] ?? "var(--text-dim)", flexShrink: 0 }} />
            {p.name}
          </span>
          <span style={{ color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{fmt(Number(p.value) || 0)}</span>
        </div>
      ))}
    </div>
  );
}

function KpiValue({ children }: { children: React.ReactNode }) {
  if (children === "-") return <span className="skeleton" aria-hidden="true" />;
  return <>{children}</>;
}

/** El ⓘ de cada tarjeta con la explicación de esa métrica. */
function KpiInfo({ children }: { children: React.ReactNode }) {
  return (
    <details className="kpi-info">
      <summary aria-label="Cómo se calcula">i</summary>
      <div className="kpi-info-panel">{children}</div>
    </details>
  );
}

export default function CampanasPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyAdsRow[] | null>(null);
  const [channels, setChannels] = useState<ChannelBreakdown | null>(null);
  const [adForm, setAdForm] = useState({ channel: "meta", date: new Date().toISOString().slice(0, 10), amount: "" });
  const [adFormError, setAdFormError] = useState("");
  const [adFormSuccess, setAdFormSuccess] = useState(false);
  const [period, setPeriod] = useState<Period>("mes");
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [noAccount, setNoAccount] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [campaignsError, setCampaignsError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { from, to } = rangeForPeriod(period, customFrom, customTo);
  const activeCampaigns = campaigns?.filter((c) => c.status === "active").length ?? 0;

  function load() {
    fetch(`/api/summary?from=${from}&to=${to}`).then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then(setSummary);
    });
    fetch(`/api/summary?groupBy=day&from=${from}&to=${to}`).then((r) => {
      if (r.status === 401) return;
      r.json().then(setDaily);
    });
    fetch(`/api/ads-spend?groupBy=channel&from=${from}&to=${to}`).then((r) => {
      if (r.status === 401) return;
      r.json().then(setChannels);
    });
  }

  function loadCampaigns() {
    setCampaignsError("");
    fetch("/api/campaigns").then(async (r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setCampaignsError(data.error ?? "No se pudieron cargar las campañas.");
        setCampaigns([]);
        return;
      }
      r.json().then(setCampaigns);
    });
  }

  useEffect(load, [from, to]);
  useEffect(loadCampaigns, []);

  async function toggleCampaign(campaignId: string, currentStatus: string) {
    const nextStatus = currentStatus === "active" ? "paused" : "active";
    setTogglingId(campaignId);
    try {
      const res = await fetch("/api/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, status: nextStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCampaignsError(data.error ?? "No se pudo cambiar el estado de la campaña.");
        return;
      }
      loadCampaigns();
    } finally {
      setTogglingId(null);
    }
  }

  if (noAccount) {
    return (
      <div>
        <h1>Campañas</h1>
        <NoAccountState />
      </div>
    );
  }

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
    load();
  }

  return (
    <div>
      <h1>Campañas</h1>

      <PeriodBar
        period={period}
        onPeriodChange={setPeriod}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />

      {/*
        Las ocho tarjetas en dos filas de cuatro, y el orden no es decorativo:
        arriba la pauta (cuánto entró de plata a los anuncios y qué devolvieron),
        abajo el negocio (qué quedó al final y cuánto cuesta de verdad operar).
        Se lee de izquierda a derecha y de arriba hacia abajo: inversión →
        retorno → eficiencia → costo, y después resultado → costo real →
        ticket → estado.
      */}
      <h2 className="section-title">Pauta y conversión</h2>
      <div className="kpi-grid kpi-grid-4">
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">Ad Spend</span><KpiInfo>Lo que gastaste en total en publicidad en el período: Mercado Ads más lo que cargaste a mano de Meta, Google o TikTok. Es el punto de partida de todo lo demás.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.adSpend) : "-"}</KpiValue></div>
          {/* Gastar más no es de por sí peor: lo que importa es lo que
              devuelve, y eso lo dicen las tarjetas de al lado. Por eso el
              badge acá no se pinta al revés como en las de costo. */}
          {summary && <DeltaPill current={summary.adSpend} previous={summary.previous?.adSpend} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">ROAS</span><KpiInfo>Hoy se calcula igual que MER: Mercado Libre no separa qué parte de la facturación vino puntualmente de un anuncio, así que no hay forma de aislar el retorno solo de las ventas por Ads.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? summary.roas.toFixed(2) : "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.roas} previous={summary.previous?.roas} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">MER</span><KpiInfo>Facturación ÷ Gasto en Ads. Cuántos pesos facturaste por cada peso que invertiste en publicidad — contando toda la facturación, no solo la que vino de un anuncio.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? summary.mer.toFixed(2) : "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.mer} previous={summary.previous?.mer} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">CPA</span><KpiInfo>Gasto en Ads ÷ Cantidad de órdenes del período. Cuánto costó, en promedio, cada orden — le atribuyas o no esa orden puntual a un anuncio.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.cpa) : "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.cpa} previous={summary.previous?.cpa} lowerIsBetter />}
        </div>
      </div>

      <h2 className="section-title">Impacto en el negocio</h2>
      <div className="kpi-grid kpi-grid-4">
        {/* En negro, como en Resumen: de las ocho, es la única que contesta
            "¿al final me quedó plata?". Si se ve igual que las otras siete, la
            grilla no tiene dónde empezar a leerse. */}
        <div className="kpi-card kpi-hero">
          <div className="kpi-card-head"><span className="label">Ganancia neta</span><KpiInfo>Ganancia neta del período completo, ya descontando comisión, envío, publicidad, costo e impuestos. Es el número contra el que hay que leer el Ad Spend de arriba.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.netProfit) : "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.netProfit} previous={summary.previous?.netProfit} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">True CPA</span><KpiInfo>Gasto en Ads ÷ Órdenes que ya tienen costo cargado. Igual que el CPA de arriba pero solo sobre las órdenes con ganancia real calculada, para no subestimar el costo por orden cuando todavía falta cargar costos.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.trueCpa) : "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.trueCpa} previous={summary.previous?.trueCpa} lowerIsBetter />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">Net AOV</span><KpiInfo>Ganancia neta ÷ Órdenes. La ganancia real que te deja, en promedio, cada orden. Si el CPA de arriba se le acerca, cada venta nueva deja de aportar.</KpiInfo></div>
          <div className="value"><KpiValue>{summary ? fmt(summary.netAov) : "-"}</KpiValue></div>
          {summary && <DeltaPill current={summary.netAov} previous={summary.previous?.netAov} />}
        </div>
        <div className="kpi-card">
          <div className="kpi-card-head"><span className="label">Campañas activas</span><KpiInfo>Cantidad de campañas de Mercado Ads corriendo ahora mismo. No cuenta las pausadas.</KpiInfo></div>
          <div className="value"><KpiValue>{campaigns ? String(activeCampaigns) : "-"}</KpiValue></div>
          {/* Sin badge de variación a propósito: es el estado de ahora, no un
              acumulado del período. No existe "las campañas activas del mes
              pasado" contra qué compararlo. */}
          {campaigns && (
            <div className="kpi-delta">
              <span className="kpi-delta-caption">
                {campaigns.length === 0
                  ? "Sin campañas creadas"
                  : `de ${campaigns.length} ${campaigns.length === 1 ? "campaña" : "campañas"} en total`}
              </span>
            </div>
          )}
        </div>
      </div>

      <h2 className="section-title">Gasto en Ads y su efecto en la ganancia</h2>
      <div className="chart-split-even">
        <div className="chart-card">
          <div className="chart-card-head">
            <h3 className="chart-card-title">Gasto en Ads vs. facturación</h3>
            <span className="field-hint" style={{ margin: 0 }}>
              Mercado Libre no dice qué venta vino de qué anuncio, así que la línea es la facturación entera del día,
              no solo la atribuida
            </span>
          </div>
          {daily && daily.every((d) => d.ads === 0) ? (
            <p className="empty-state">Sin gasto en publicidad en este período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={daily ?? []} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--text-dim)" }} tickLine={false} axisLine={false} minTickGap={24} />
                {/* Dos ejes: la facturación es de otro orden de magnitud que el
                    gasto, y en un eje compartido la serie de Ads quedaba
                    aplastada contra el piso del gráfico. */}
                <YAxis yAxisId="ads" tick={{ fontSize: 11, fill: "var(--text-dim)" }} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => fmt(Number(v))} />
                <YAxis yAxisId="revenue" orientation="right" tick={{ fontSize: 11, fill: "var(--text-dim)" }} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => fmt(Number(v))} />
                <Tooltip content={<AdsProfitTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="square" />
                <Area yAxisId="ads" type="monotone" dataKey="ads" name="Gasto en Ads" stroke="var(--chart-ads)" fill="var(--chart-ads)" fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />
                <Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Facturación" stroke="var(--accent-strong)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-card-head">
            <h3 className="chart-card-title">Publicidad vs. Ganancia neta</h3>
            <span className="field-hint" style={{ margin: 0 }}>Para ver si los días de más gasto son también los de más ganancia</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={daily ?? []} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--text-dim)" }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis yAxisId="ads" tick={{ fontSize: 11, fill: "var(--text-dim)" }} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => fmt(Number(v))} />
              <YAxis yAxisId="profit" orientation="right" tick={{ fontSize: 11, fill: "var(--text-dim)" }} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => fmt(Number(v))} />
              <Tooltip content={<AdsProfitTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="square" />
              <Bar yAxisId="ads" dataKey="ads" name="Gasto en Ads" fill="var(--chart-ads)" isAnimationActive={false} />
              <Line yAxisId="profit" type="monotone" dataKey="netProfit" name="Ganancia neta" stroke="var(--positive)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/*
        Dónde se fue la plata de la pauta. El Ad Spend de arriba dice cuánto se
        gastó; esto dice en qué plataforma, que es lo que hace falta para
        decidir dónde recortar.

        Solo se reparte el gasto, nunca los ingresos: sin un dato de atribución
        real, un ROAS por canal sería un número inventado con cara de dato.
      */}
      <h2 className="section-title">Dónde se gastó, por plataforma</h2>
      {channels === null ? (
        <p className="empty-state">Cargando desglose…</p>
      ) : channels.channels.length === 0 ? (
        <p className="empty-state">Sin gasto en publicidad en este período.</p>
      ) : (
        <div className="table-wrap table-scroll" style={{ marginBottom: "var(--space-5)" }}>
          <table>
            <thead>
              <tr>
                <th>Plataforma</th>
                <th className="num">Gasto</th>
                <th className="num">% del total</th>
                <th>Atribución</th>
              </tr>
            </thead>
            <tbody>
              {channels.channels.map((c) => (
                <tr key={c.channel}>
                  <td>{c.label}</td>
                  <td className="num">{fmt(c.amount)}</td>
                  <td className="num">{(c.share * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%</td>
                  <td>
                    <span className={`badge ${c.attributed ? "badge-paid" : "badge-other"}`}>
                      {c.attributed ? "Por producto" : "Solo total"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <th className="num">{fmt(channels.total)}</th>
                <th className="num">100%</th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <h2 className="section-title">Campañas de Mercado Ads</h2>
      {campaignsError && <p className="field-error" role="alert" style={{ marginBottom: "var(--space-3)" }}>{campaignsError}</p>}
      {campaigns === null ? (
        <p className="empty-state">Cargando campañas…</p>
      ) : campaigns.length === 0 && !campaignsError ? (
        <div className="empty-state">
          <p style={{ margin: 0, fontWeight: 600, color: "var(--text)" }}>No tenés campañas de Mercado Ads.</p>
          <p style={{ margin: "var(--space-2) 0 0" }}>
            Cuando crees una campaña de Product Ads en Mercado Libre, va a aparecer acá y vas a poder
            pausarla o reactivarla sin salir del dashboard.
          </p>
        </div>
      ) : campaigns.length > 0 ? (
        <div className="table-wrap table-scroll" style={{ marginBottom: "var(--space-5)" }}>
          <table>
            <thead>
              <tr>
                <th>Campaña</th>
                <th>Estado</th>
                <th className="num">Presupuesto</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    <span className={`badge ${c.status === "active" ? "badge-paid" : "badge-other"}`}>{c.status}</span>
                  </td>
                  <td className="num">{fmt(c.budget)}</td>
                  <td>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => toggleCampaign(c.id, c.status)}
                      disabled={togglingId === c.id}
                    >
                      {togglingId === c.id ? "…" : c.status === "active" ? "Pausar" : "Reactivar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

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
    </div>
  );
}
