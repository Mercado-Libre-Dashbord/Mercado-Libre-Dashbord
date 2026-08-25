"use client";

import { useEffect, useState } from "react";
import { NoAccountState } from "../NoAccountState";
import { PeriodBar } from "../PeriodBar";
import { Period, rangeForPeriod, toDateStr } from "@/lib/period";

interface Summary {
  adSpend: number;
  mer: number;
  roas: number;
  cpa: number;
  netAov: number;
  trueCpa: number;
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

function KpiValue({ children }: { children: React.ReactNode }) {
  if (children === "-") return <span className="skeleton" aria-hidden="true" />;
  return <>{children}</>;
}

export default function CampanasPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
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

  function load() {
    fetch(`/api/summary?from=${from}&to=${to}`).then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then(setSummary);
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

      <h2 className="section-title">Anuncios</h2>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="label">Ad Spend</div><div className="value"><KpiValue>{summary ? fmt(summary.adSpend) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">MER</div><div className="value"><KpiValue>{summary ? summary.mer.toFixed(2) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">ROAS</div><div className="value"><KpiValue>{summary ? summary.roas.toFixed(2) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">CPA</div><div className="value"><KpiValue>{summary ? fmt(summary.cpa) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">Net AOV</div><div className="value"><KpiValue>{summary ? fmt(summary.netAov) : "-"}</KpiValue></div></div>
        <div className="kpi-card"><div className="label">True CPA</div><div className="value"><KpiValue>{summary ? fmt(summary.trueCpa) : "-"}</KpiValue></div></div>
      </div>

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
