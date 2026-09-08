"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type TaxCondition = "responsable_inscripto" | "monotributo" | "exento";

const TAX_CONDITION_LABEL: Record<TaxCondition, string> = {
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributista",
  exento: "Exento",
};

/**
 * Bloquea toda la app hasta que una cuenta nueva elija su régimen fiscal.
 *
 * El bug real que lo motivó: un cliente Monotributista estuvo semanas con el
 * IVA mal calculado porque nadie le preguntó su régimen al conectar la
 * cuenta, y Configuración no es una pantalla que un vendedor nuevo visite
 * antes de mirar sus números. Esto lo pregunta antes de mostrar cualquier otra cosa.
 */
export function TaxConditionGate() {
  const { status } = useSession();
  const [pending, setPending] = useState<{ otherTaxRate: number } | null>(null);
  const [taxCondition, setTaxCondition] = useState<TaxCondition>("responsable_inscripto");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/account/settings")
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        if (data.taxConditionConfirmed === false) {
          setPending({ otherTaxRate: Number(data.otherTaxRate ?? 0) });
        }
      })
      .catch(() => {});
  }, [status]);

  if (!pending) return null;

  async function confirm() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/account/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otherTaxRate: pending!.otherTaxRate, taxCondition }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo guardar. Probá de nuevo.");
        return;
      }
      setPending(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tax-gate-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "var(--space-4)",
      }}
    >
      <div className="day-card" style={{ maxWidth: 480, width: "100%", marginBottom: 0 }}>
        <h2 id="tax-gate-title" style={{ marginTop: 0 }}>¿Cuál es tu condición ante IVA?</h2>
        <p className="field-hint" style={{ marginBottom: "var(--space-4)" }}>
          Lo necesitamos para calcular bien tu ganancia neta: el IVA solo se descuenta si sos Responsable
          Inscripto. Lo podés cambiar después en Configuración.
        </p>

        <div className="field-group" style={{ maxWidth: 320 }}>
          {(Object.keys(TAX_CONDITION_LABEL) as TaxCondition[]).map((key) => (
            <label
              key={key}
              style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) 0" }}
            >
              <input
                type="radio"
                name="tax-condition"
                value={key}
                checked={taxCondition === key}
                onChange={() => setTaxCondition(key)}
              />
              {TAX_CONDITION_LABEL[key]}
            </label>
          ))}
        </div>

        {error && <p className="field-error" role="alert">{error}</p>}

        <div style={{ marginTop: "var(--space-4)" }}>
          <button className="btn btn-primary" onClick={confirm} disabled={saving}>
            {saving ? "Guardando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
