/**
 * Estado de las facturas que Mercado Libre le emite al vendedor, y cuándo
 * avisarle.
 *
 * ML factura por período (quincenal o mensual) las comisiones, los envíos y
 * la publicidad acumulados. Si al vencimiento el saldo en Mercado Pago no
 * alcanza, la cuenta queda en deuda: se acumulan intereses y, si sigue, se
 * suspenden las publicaciones. Enterarse tarde es caro, y la plataforma no
 * avisa con tiempo.
 *
 * Todo acá es lógica pura sobre fechas y montos: sin red, sin base. Es lo que
 * permite probar los bordes que importan —el día exacto del vencimiento, el
 * período que todavía suma cargos— sin depender de la API.
 *
 * IMPORTANTE, y es la razón de que haya tantos estados y no tres: la API de
 * facturación de ML confirma si un período está OPEN o CLOSED y por cuánto,
 * pero NO si está pagado. Inventar un "Pagada" verde a partir de eso sería
 * decirle al vendedor que está al día sin tener con qué respaldarlo — el peor
 * error posible en una pantalla cuya única función es evitar una suspensión.
 * Así que "pagada" solo existe cuando ML lo dice explícitamente, y cuando no
 * se sabe, se dice que no se sabe.
 */

export type InvoiceState =
  /** Todavía sumando cargos: el monto no es definitivo y no hay qué pagar aún. */
  | "en_curso"
  /** Cerrada, con fecha de vencimiento futura. */
  | "por_vencer"
  /** Cerrada y pasada de fecha. */
  | "vencida"
  /** ML confirmó que está paga. */
  | "pagada"
  /** Cerrada, con monto, pero sin fecha de vencimiento que leer. */
  | "cerrada_sin_fecha";

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = {
  en_curso: "En curso",
  por_vencer: "Pendiente por vencer",
  vencida: "Vencida / en mora",
  pagada: "Pagada",
  cerrada_sin_fecha: "Cerrada — vencimiento no informado",
};

/** Cuándo avisar antes del vencimiento. Los dos avisos de la especificación. */
export const ALERT_DAYS_BEFORE = [5, 1] as const;

export type AlertLevel = "vencida" | "vence_manana" | "vence_pronto" | null;

export interface BillingPeriodInput {
  key: string;
  dateFrom: string | null;
  dateTo: string | null;
  amount: number;
  /** OPEN | CLOSED, como lo devuelve ML. */
  periodStatus: string | null;
  /** Vencimiento YYYY-MM-DD, si ML lo informó. */
  dueDate?: string | null;
  /** Solo si ML lo dice explícitamente. `undefined` = no se sabe. */
  paid?: boolean | null;
}

export interface InvoiceStatus extends BillingPeriodInput {
  state: InvoiceState;
  /** Días hasta el vencimiento; negativo si ya pasó. Null sin fecha. */
  daysUntilDue: number | null;
  alert: AlertLevel;
  /** Qué decirle al vendedor. Vacío si no hay nada que avisar. */
  message: string;
}

/** Días de diferencia entre dos fechas YYYY-MM-DD, ignorando husos. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

function money(amount: number): string {
  return amount.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

/**
 * En qué estado está una factura y qué aviso corresponde, mirada desde `today`.
 *
 * El orden de las decisiones importa: un período todavía abierto no puede
 * estar vencido aunque su fecha ya haya pasado —sigue acumulando cargos y ML
 * todavía no lo facturó— y una factura que ML confirma paga no dispara ningún
 * aviso por más que la fecha haya quedado atrás.
 */
export function evaluateInvoice(period: BillingPeriodInput, today: string): InvoiceStatus {
  const daysUntilDue = period.dueDate ? daysBetween(today, period.dueDate) : null;

  if (period.paid === true) {
    return { ...period, state: "pagada", daysUntilDue, alert: null, message: "" };
  }

  // Un período OPEN sigue sumando cargos: el monto todavía va a cambiar y no
  // hay nada que pagar. Avisar acá sería avisar por un número que no es.
  if ((period.periodStatus ?? "").toUpperCase() === "OPEN") {
    return {
      ...period,
      state: "en_curso",
      daysUntilDue,
      alert: null,
      message: "",
    };
  }

  // Un cargo sin monto no es una deuda, no importa qué fecha tenga.
  if (period.amount <= 0) {
    return { ...period, state: "pagada", daysUntilDue, alert: null, message: "" };
  }

  if (daysUntilDue === null) {
    return {
      ...period,
      state: "cerrada_sin_fecha",
      daysUntilDue,
      alert: null,
      message: `Factura de ${money(period.amount)} cerrada. Mercado Libre no informó la fecha de vencimiento: revisá tu saldo en Mercado Pago.`,
    };
  }

  if (daysUntilDue < 0) {
    const days = Math.abs(daysUntilDue);
    return {
      ...period,
      state: "vencida",
      daysUntilDue,
      alert: "vencida",
      message: `Factura vencida hace ${days} ${days === 1 ? "día" : "días"} por ${money(period.amount)}. Regularizá el pago para evitar restricciones en tus publicaciones.`,
    };
  }

  if (daysUntilDue === 0) {
    return {
      ...period,
      state: "por_vencer",
      daysUntilDue,
      alert: "vence_manana",
      message: `Hoy vence la factura de ${money(period.amount)}. Revisá que tengas saldo disponible.`,
    };
  }

  if (daysUntilDue <= 1) {
    return {
      ...period,
      state: "por_vencer",
      daysUntilDue,
      alert: "vence_manana",
      message: `Atención: mañana vence la factura de ${money(period.amount)}. Revisá tu saldo para evitar restricciones.`,
    };
  }

  if (daysUntilDue <= ALERT_DAYS_BEFORE[0]) {
    return {
      ...period,
      state: "por_vencer",
      daysUntilDue,
      alert: "vence_pronto",
      message: `Factura de cargos generada por ${money(period.amount)}. Vence en ${daysUntilDue} días: revisá tu saldo disponible.`,
    };
  }

  return { ...period, state: "por_vencer", daysUntilDue, alert: null, message: "" };
}

export interface BillingHealth {
  invoices: InvoiceStatus[];
  /** Plata de facturas cerradas y pasadas de fecha. */
  overdueAmount: number;
  /** Plata de facturas cerradas que todavía no vencieron. */
  dueSoonAmount: number;
  /** Lo que se está acumulando en el período abierto. */
  accruingAmount: number;
  /** Los avisos que corresponde mandar hoy, del más urgente al menos. */
  alerts: InvoiceStatus[];
}

const ALERT_PRIORITY: Record<Exclude<AlertLevel, null>, number> = {
  vencida: 0,
  vence_manana: 1,
  vence_pronto: 2,
};

/**
 * El panel de salud fiscal: en qué estado está cada factura y cuánta plata
 * hay en juego en cada uno.
 */
export function billingHealth(periods: BillingPeriodInput[], today: string): BillingHealth {
  const invoices = periods.map((p) => evaluateInvoice(p, today));

  return {
    invoices,
    overdueAmount: sumWhere(invoices, (i) => i.state === "vencida"),
    dueSoonAmount: sumWhere(invoices, (i) => i.state === "por_vencer" || i.state === "cerrada_sin_fecha"),
    accruingAmount: sumWhere(invoices, (i) => i.state === "en_curso"),
    alerts: invoices
      .filter((i) => i.alert !== null)
      .sort((a, b) => ALERT_PRIORITY[a.alert!] - ALERT_PRIORITY[b.alert!]),
  };
}

function sumWhere(invoices: InvoiceStatus[], predicate: (i: InvoiceStatus) => boolean): number {
  return invoices.filter(predicate).reduce((sum, i) => sum + i.amount, 0);
}

/**
 * Por dónde sale un aviso.
 *
 * Se deja como interfaz a propósito, igual que `InvoiceProvider` en
 * lib/invoicing.ts: mandar un push, un mail o un WhatsApp depende de un
 * servicio que esta app todavía no tiene contratado, y esa decisión no
 * cambia nada de la lógica de arriba. Lo que sí existe hoy es el cálculo de
 * qué avisar y cuándo, y el panel que lo muestra; el día que haya un canal,
 * se implementa esto y los mismos avisos salen por ahí.
 */
export interface BillingNotifier {
  readonly name: string;
  notify(accountId: string, alert: InvoiceStatus): Promise<void>;
}

/**
 * Manda los avisos que correspondan hoy y devuelve cuáles salieron.
 *
 * `alreadyNotified` evita repetir el mismo aviso todos los días: un
 * "vence en 5 días" que llega cinco veces deja de leerse, y el día que
 * importa se ignora como los anteriores.
 */
export async function dispatchBillingAlerts(
  notifier: BillingNotifier,
  accountId: string,
  health: BillingHealth,
  alreadyNotified: ReadonlySet<string> = new Set()
): Promise<InvoiceStatus[]> {
  const sent: InvoiceStatus[] = [];
  for (const alert of health.alerts) {
    const fingerprint = `${alert.key}:${alert.alert}`;
    if (alreadyNotified.has(fingerprint)) continue;
    await notifier.notify(accountId, alert);
    sent.push(alert);
  }
  return sent;
}
