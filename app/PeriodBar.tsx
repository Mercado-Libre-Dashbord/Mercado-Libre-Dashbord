"use client";

import { Period, PERIOD_OPTIONS } from "@/lib/period";

/**
 * Selector de temporalidad como barra de botones a todo el ancho.
 * Antes era un <select> que desperdiciaba la barra entera: obligaba a dos
 * clics (abrir + elegir) y escondía las opciones disponibles.
 *
 * En pantallas chicas la barra scrollea horizontal en vez de romper el
 * layout — patrón estándar para toolbars de filtros.
 */
export function PeriodBar({
  period,
  onPeriodChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
}: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
}) {
  return (
    <div className="period-wrap">
      <div className="period-bar" role="group" aria-label="Período">
        {PERIOD_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`period-btn${period === o.value ? " active" : ""}`}
            aria-pressed={period === o.value}
            onClick={() => onPeriodChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="period-custom">
          <label>
            Desde
            <input type="date" value={customFrom} onChange={(e) => onCustomFromChange(e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={customTo} onChange={(e) => onCustomToChange(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
