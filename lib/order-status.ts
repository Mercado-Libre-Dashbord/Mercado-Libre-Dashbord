/**
 * Una orden cancelada (o inválida) no es facturación ni ganancia: la plata
 * nunca entró. Antes se sumaban igual que una pagada, así que Facturación,
 * Ganancia neta y el Top de productos venían inflados.
 *
 * Se siguen mostrando en la lista de "Últimas órdenes" (con su badge), pero
 * quedan fuera de todo agregado financiero.
 */
export const NON_REVENUE_STATUSES = ["cancelled", "invalid"] as const;

/** Fragmento SQL para filtrar agregados. `alias` es el alias de `orders`. */
export function revenueStatusFilter(alias = "o"): string {
  const list = NON_REVENUE_STATUSES.map((s) => `'${s}'`).join(", ");
  return `${alias}.status NOT IN (${list})`;
}

export function countsAsRevenue(status: string): boolean {
  return !(NON_REVENUE_STATUSES as readonly string[]).includes(status);
}
