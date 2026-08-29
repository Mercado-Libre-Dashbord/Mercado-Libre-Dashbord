"use client";

import { useEffect, useState } from "react";
import { NoAccountState } from "../NoAccountState";

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });

const MISSION_LABEL: Record<string, string> = {
  seguir_tienda: "Seguir la tienda",
  dejar_opinion: "Dejar una opinión",
  opinion_con_foto: "Opinión con foto",
};

interface Mission {
  id: string;
  label: string;
  description: string;
  defaultPoints: number;
}

interface Member {
  memberId: string;
  name: string | null;
  email: string | null;
  joinedAt: string;
  missions: string[];
  points: number;
  pointsToReward: number;
  couponCode: string | null;
  grantedAt: string | null;
}

interface Stats {
  members: number;
  missionsCompleted: number;
  couponsGranted: number;
  committedDiscount: number;
  potentialRevenue: number;
  rewardBudget: number;
  active: boolean;
}

interface Program {
  active: boolean;
  points: Record<string, number>;
  rewardThreshold: number;
  rewardAmount: number;
  rewardMinPurchase: number;
  rewardBudget: number;
}

export default function LoyaltyPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [program, setProgram] = useState<Program | null>(null);
  const [available, setAvailable] = useState(true);
  const [errors, setErrors] = useState<{ field: string; message: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [noAccount, setNoAccount] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tally, setTally] = useState<{ mission: string; count: number }[]>([]);

  useEffect(() => {
    fetch("/api/loyalty").then(async (r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      const data = await r.json();
      setMissions(data.missions ?? []);
      setAvailable(data.available !== false);
      setProgram(data.program);
    });

    // El detalle de miembros va aparte de la configuración: si el módulo
    // todavía no tiene su migración, la pantalla de configuración igual sirve.
    fetch("/api/loyalty/members").then(async (r) => {
      if (!r.ok) { setMembers([]); return; }
      const data = await r.json();
      setMembers(data.members ?? []);
      setStats(data.stats ?? null);
      setTally(data.tally ?? []);
    });
  }, []);

  if (noAccount) {
    return (
      <div>
        <h1>Fidelización</h1>
        <NoAccountState />
      </div>
    );
  }

  function set<K extends keyof Program>(key: K, value: Program[K]) {
    setProgram((p) => (p ? { ...p, [key]: value } : p));
    setSaved(false);
    setErrors([]);
  }

  async function save() {
    if (!program) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/loyalty", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(program),
      });
      const data = await res.json();
      if (!res.ok) { setErrors(data.errors ?? [{ field: "", message: data.error }]); return; }
      setErrors([]);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message;
  const totalPossible = missions.reduce((sum, m) => sum + (program?.points[m.id] ?? m.defaultPoints), 0);

  return (
    <div>
      <h1>Fidelización</h1>
      <p className="field-hint" style={{ maxWidth: "72ch", marginBottom: "var(--space-4)" }}>
        Tus compradores suman puntos por acciones dentro de Mercado Libre y, al llegar al objetivo, reciben un
        cupón oficial de tu tienda. Todo pasa dentro de la plataforma: nada saca al comprador afuera, que es lo
        que hace que el programa no sea sancionable.
      </p>

      {!available && (
        <p className="field-error" role="alert">
          Falta correr <code>db/postgres/migrations/009-loyalty.sql</code> para activar este módulo.
        </p>
      )}

      {program === null ? (
        <p className="empty-state">Cargando…</p>
      ) : (
        <>
          <h2 className="section-title">Cómo va el programa</h2>
          {members === null ? (
            <p className="empty-state">Cargando…</p>
          ) : stats === null || stats.members === 0 ? (
            <div className="empty-state">
              <p style={{ margin: 0, fontWeight: 600, color: "var(--text)" }}>Todavía no se sumó nadie.</p>
              <p style={{ margin: "var(--space-2) 0 0" }}>
                Los compradores entran escaneando el QR que ponés en el paquete. Apenas el primero se registre,
                acá vas a ver quién es, qué misiones cumplió y cuántos puntos lleva.
              </p>
            </div>
          ) : (
            <>
              <div className="kpi-grid" style={{ marginBottom: "var(--space-3)" }}>
                <div className="kpi-card">
                  <div className="kpi-card-head"><span className="label">Miembros</span></div>
                  <div className="value">{stats.members.toLocaleString("es-AR")}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-card-head"><span className="label">Misiones cumplidas</span></div>
                  <div className="value">{stats.missionsCompleted.toLocaleString("es-AR")}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-card-head"><span className="label">Cupones emitidos</span></div>
                  <div className="value">{stats.couponsGranted.toLocaleString("es-AR")}</div>
                  <div className="kpi-delta">
                    <span className="kpi-delta-caption">
                      {fmt(stats.committedDiscount)} de descuento comprometido, sobre un tope de {fmt(stats.rewardBudget)}
                    </span>
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-card-head"><span className="label">Compra mínima asociada</span></div>
                  <div className="value">{fmt(stats.potentialRevenue)}</div>
                  <div className="kpi-delta">
                    <span className="kpi-delta-caption">Si se usaran todos los cupones emitidos</span>
                  </div>
                </div>
              </div>

              {tally.length > 0 && (
                <div className="chart-card" style={{ marginBottom: "var(--space-3)" }}>
                  <div className="chart-card-head">
                    <h3 className="chart-card-title">Qué misión funciona</h3>
                  </div>
                  <ul className="top-products">
                    {tally.map((t) => {
                      const peak = Math.max(...tally.map((x) => x.count), 1);
                      return (
                        <li className="top-product" key={t.mission}>
                          <span className="top-product-main">
                            <span className="top-product-name">{MISSION_LABEL[t.mission] ?? t.mission}</span>
                            <span className="top-product-bar" aria-hidden="true">
                              <span className="top-product-bar-fill" style={{ width: `${(t.count / peak) * 100}%` }} />
                            </span>
                          </span>
                          <span className="top-product-side" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                            {t.count}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="table-wrap table-scroll table-compact" style={{ marginBottom: "var(--space-3)" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Miembro</th>
                      <th>Se sumó</th>
                      <th>Misiones</th>
                      <th className="num">Puntos</th>
                      <th>Premio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.memberId}>
                        <td>
                          <span style={{ fontWeight: 600 }}>{m.name || m.memberId}</span>
                          {m.email && <span className="cell-sub">{m.email}</span>}
                        </td>
                        <td style={{ color: "var(--text-dim)" }}>{fmtDate(m.joinedAt)}</td>
                        <td style={{ color: "var(--text-dim)" }}>
                          {m.missions.length === 0
                            ? "—"
                            : m.missions.map((x) => MISSION_LABEL[x] ?? x).join(" · ")}
                        </td>
                        <td className="num">
                          {m.points.toLocaleString("es-AR")}
                          {!m.couponCode && m.pointsToReward > 0 && (
                            <span className="cell-sub">faltan {m.pointsToReward.toLocaleString("es-AR")}</span>
                          )}
                        </td>
                        <td>
                          {m.couponCode ? (
                            <span className="badge badge-paid">{m.couponCode}</span>
                          ) : (
                            <span style={{ color: "var(--text-dim)" }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details className="explain-box" style={{ marginBottom: "var(--space-5)" }}>
                <summary>Qué medimos acá y qué todavía no</summary>
                <ul>
                  <li>
                    <strong>Descuento comprometido</strong> es lo que te costarían todos los cupones emitidos si se
                    usaran. No es plata gastada: es el techo del riesgo, y el presupuesto lo frena.
                  </li>
                  <li>
                    <strong>Compra mínima asociada</strong> es el piso de facturación que traerían esos cupones,
                    porque cada uno exige una compra mínima para poder usarse.
                  </li>
                  <li>
                    <strong>Lo que todavía no sabemos</strong> es cuáles de esos cupones se usaron de verdad.
                    Mercado Libre no nos dice qué orden usó qué cupón, así que no podemos atribuir una venta
                    puntual a un miembro. Estamos viendo cómo resolverlo.
                  </li>
                </ul>
              </details>
            </>
          )}

          <h2 className="section-title">Misiones</h2>
          <div className="table-wrap" style={{ marginBottom: "var(--space-4)" }}>
            <table>
              <thead>
                <tr>
                  <th>Misión</th>
                  <th>Qué ve el comprador</th>
                  <th className="num">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {missions.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 600 }}>{m.label}</td>
                    <td style={{ color: "var(--text-dim)" }}>{m.description}</td>
                    <td className="num">
                      <input
                        type="number"
                        min="0"
                        step="50"
                        aria-label={`Puntos por ${m.label}`}
                        value={program.points[m.id] ?? m.defaultPoints}
                        onChange={(e) => set("points", { ...program.points, [m.id]: Number(e.target.value) })}
                        style={{ width: 90 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="section-title">Premio</h2>
          <div className="day-card" style={{ maxWidth: 720 }}>
            <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
              <div className="field-group">
                <label className="field-hint" htmlFor="threshold">Puntos para el premio</label>
                <input id="threshold" type="number" min="0" step="100" style={{ width: 130 }}
                  value={program.rewardThreshold}
                  onChange={(e) => set("rewardThreshold", Number(e.target.value))} />
                <span className="field-hint">Máximo posible: {totalPossible}</span>
                {errorFor("rewardThreshold") && <p className="field-error">{errorFor("rewardThreshold")}</p>}
              </div>
              <div className="field-group">
                <label className="field-hint" htmlFor="amount">Valor del cupón ($)</label>
                <input id="amount" type="number" min="0" step="100" style={{ width: 130 }}
                  value={program.rewardAmount}
                  onChange={(e) => set("rewardAmount", Number(e.target.value))} />
                {errorFor("rewardAmount") && <p className="field-error">{errorFor("rewardAmount")}</p>}
              </div>
              <div className="field-group">
                <label className="field-hint" htmlFor="min">Compra mínima ($)</label>
                <input id="min" type="number" min="0" step="100" style={{ width: 130 }}
                  value={program.rewardMinPurchase}
                  onChange={(e) => set("rewardMinPurchase", Number(e.target.value))} />
                {errorFor("rewardMinPurchase") && <p className="field-error">{errorFor("rewardMinPurchase")}</p>}
              </div>
              <div className="field-group">
                <label className="field-hint" htmlFor="budget">Presupuesto total ($)</label>
                <input id="budget" type="number" min="0" step="1000" style={{ width: 130 }}
                  value={program.rewardBudget}
                  onChange={(e) => set("rewardBudget", Number(e.target.value))} />
                <span className="field-hint">Tope de descuentos</span>
                {errorFor("rewardBudget") && <p className="field-error">{errorFor("rewardBudget")}</p>}
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
              <input type="checkbox" checked={program.active} onChange={(e) => set("active", e.target.checked)} />
              <span>Programa activo</span>
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
              <button className="btn btn-primary" onClick={save} disabled={saving || !available}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
              {saved && <span role="status" aria-live="polite" className="success-text">Guardado.</span>}
            </div>

            <details className="explain-box" style={{ marginTop: "var(--space-4)", marginBottom: 0 }}>
              <summary>¿Cómo funciona y por qué es seguro?</summary>
              <ul>
                <li>
                  <strong>Seguir la tienda</strong> es la misión de mayor retorno: al seguirte, el comprador queda
                  alcanzado por tu canal de difusión, tus historias y las notificaciones de Mercado Libre.
                </li>
                <li>
                  <strong>Dejar una opinión</strong> premia el acto de opinar, nunca la calificación. Condicionar
                  puntos a una opinión positiva es manipulación de reseñas y está prohibido.
                </li>
                <li>
                  <strong>El premio es un cupón oficial de Mercado Libre</strong>, emitido por su API. El comprador
                  lo usa sin salir de la plataforma.
                </li>
                <li>
                  <strong>El presupuesto es un tope duro</strong>: Mercado Libre deja de aplicar el cupón cuando se
                  agota, así que un error de configuración no puede vaciarte la caja.
                </li>
              </ul>
            </details>
          </div>
        </>
      )}
    </div>
  );
}
