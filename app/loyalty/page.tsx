"use client";

import { useEffect, useState } from "react";
import { NoAccountState } from "../NoAccountState";

interface Mission {
  id: string;
  label: string;
  description: string;
  defaultPoints: number;
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

  useEffect(() => {
    fetch("/api/loyalty").then(async (r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      const data = await r.json();
      setMissions(data.missions ?? []);
      setAvailable(data.available !== false);
      setProgram(data.program);
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
