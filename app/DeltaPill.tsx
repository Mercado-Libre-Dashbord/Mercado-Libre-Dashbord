"use client";

interface DeltaPillProps {
  current: number;
  previous: number | null | undefined;
  /**
   * Para métricas de costo (CPA, True CPA): que suban es una mala noticia.
   *
   * Sin esto, un CPA que se disparó 40% se pintaba de verde con una flecha
   * para arriba — el color decía "bien" justo cuando hay que preocuparse.
   * La flecha sigue indicando la dirección real del número; lo que cambia es
   * de qué color se lee esa dirección.
   */
  lowerIsBetter?: boolean;
}

/**
 * "+12% vs. período anterior" de una métrica.
 *
 * No se muestra nada si no hay un período anterior con qué comparar: un
 * "+100%" contra cero no informa, confunde.
 */
export function DeltaPill({ current, previous, lowerIsBetter = false }: DeltaPillProps) {
  if (previous === null || previous === undefined || previous <= 0) return null;
  const change = (current - previous) / previous;
  if (!Number.isFinite(change)) return null;
  const up = change >= 0;
  const good = lowerIsBetter ? !up : up;
  // El "vs. período anterior" va afuera de la píldora: adentro obligaba a la
  // píldora redondeada a partirse en dos líneas en las tarjetas angostas.
  return (
    <div className="kpi-delta">
      <span className={`delta-pill ${good ? "up" : "down"}`}>
        {up ? "↑" : "↓"} {Math.abs(change * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%
      </span>
      <span className="kpi-delta-caption">vs. período anterior</span>
    </div>
  );
}
