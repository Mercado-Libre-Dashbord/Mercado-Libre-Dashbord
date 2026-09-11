import { describe, it, expect, vi } from "vitest";
import {
  evaluateInvoice,
  billingHealth,
  dispatchBillingAlerts,
  daysBetween,
  type BillingPeriodInput,
} from "./billing-alerts";

const TODAY = "2026-09-11";

function period(overrides: Partial<BillingPeriodInput> = {}): BillingPeriodInput {
  return {
    key: "2026-08-01",
    dateFrom: "2026-08-01",
    dateTo: "2026-08-31",
    amount: 120000,
    periodStatus: "CLOSED",
    dueDate: "2026-09-20",
    ...overrides,
  };
}

describe("daysBetween", () => {
  it("counts calendar days forward and backward", () => {
    expect(daysBetween("2026-09-11", "2026-09-16")).toBe(5);
    expect(daysBetween("2026-09-11", "2026-09-01")).toBe(-10);
    expect(daysBetween("2026-09-11", "2026-09-11")).toBe(0);
  });

  it("returns null for a date it cannot read", () => {
    expect(daysBetween("2026-09-11", "no-es-una-fecha")).toBeNull();
  });
});

describe("evaluateInvoice", () => {
  it("says nothing about a period that is still accumulating charges", () => {
    // El monto de un período OPEN todavía va a cambiar: avisar acá sería
    // avisar por un número que no es el que se va a pagar.
    const result = evaluateInvoice(period({ periodStatus: "OPEN" }), TODAY);
    expect(result.state).toBe("en_curso");
    expect(result.alert).toBeNull();
    expect(result.message).toBe("");
  });

  it("does not mark an open period as overdue even once its dates have passed", () => {
    const result = evaluateInvoice(period({ periodStatus: "OPEN", dueDate: "2026-09-01" }), TODAY);
    expect(result.state).toBe("en_curso");
  });

  it("warns five days out", () => {
    const result = evaluateInvoice(period({ dueDate: "2026-09-16" }), TODAY);
    expect(result.state).toBe("por_vencer");
    expect(result.alert).toBe("vence_pronto");
    expect(result.message).toContain("Vence en 5 días");
  });

  it("stays quiet while the due date is still far away", () => {
    const result = evaluateInvoice(period({ dueDate: "2026-09-30" }), TODAY);
    expect(result.state).toBe("por_vencer");
    expect(result.alert).toBeNull();
  });

  it("escalates the day before", () => {
    const result = evaluateInvoice(period({ dueDate: "2026-09-12" }), TODAY);
    expect(result.alert).toBe("vence_manana");
    expect(result.message).toContain("mañana vence");
  });

  it("treats the due date itself as urgent, not as still pending", () => {
    // El borde que más importa: el día del vencimiento todavía se puede pagar,
    // pero un "vence en 0 días" no le dice nada a nadie.
    const result = evaluateInvoice(period({ dueDate: TODAY }), TODAY);
    expect(result.state).toBe("por_vencer");
    expect(result.alert).toBe("vence_manana");
    expect(result.message).toContain("Hoy vence");
  });

  it("reports an overdue invoice with how long it has been in arrears", () => {
    const result = evaluateInvoice(period({ dueDate: "2026-09-08" }), TODAY);
    expect(result.state).toBe("vencida");
    expect(result.alert).toBe("vencida");
    expect(result.daysUntilDue).toBe(-3);
    expect(result.message).toContain("3 días");
  });

  it("says the due date is unknown instead of inventing one", () => {
    // ML no siempre informa el vencimiento. Suponerlo sería peor que decirlo.
    const result = evaluateInvoice(period({ dueDate: null }), TODAY);
    expect(result.state).toBe("cerrada_sin_fecha");
    expect(result.message).toContain("no informó la fecha de vencimiento");
  });

  it("only calls an invoice paid when ML says so", () => {
    expect(evaluateInvoice(period({ paid: true, dueDate: "2026-09-01" }), TODAY).state).toBe("pagada");
    // Sin confirmación, una factura cerrada y pasada de fecha es deuda, no
    // una factura paga: decir "al día" sin respaldo es el peor error posible
    // en una pantalla que existe para evitar una suspensión.
    expect(evaluateInvoice(period({ paid: undefined, dueDate: "2026-09-01" }), TODAY).state).toBe("vencida");
    expect(evaluateInvoice(period({ paid: null, dueDate: "2026-09-01" }), TODAY).state).toBe("vencida");
  });

  it("does not turn a zero-amount period into a debt", () => {
    expect(evaluateInvoice(period({ amount: 0, dueDate: "2026-09-01" }), TODAY).state).toBe("pagada");
  });
});

describe("billingHealth", () => {
  const health = () =>
    billingHealth(
      [
        period({ key: "2026-07-01", amount: 80000, dueDate: "2026-09-05" }), // vencida
        period({ key: "2026-08-01", amount: 120000, dueDate: "2026-09-14" }), // por vencer
        period({ key: "2026-09-01", amount: 45000, periodStatus: "OPEN", dueDate: null }), // en curso
      ],
      TODAY
    );

  it("splits the money into overdue, upcoming and still accruing", () => {
    const h = health();
    expect(h.overdueAmount).toBe(80000);
    expect(h.dueSoonAmount).toBe(120000);
    expect(h.accruingAmount).toBe(45000);
  });

  it("puts the most urgent alert first", () => {
    const h = health();
    expect(h.alerts.map((a) => a.alert)).toEqual(["vencida", "vence_pronto"]);
  });

  it("does not count what is still accruing as debt", () => {
    // Es el error que hace que el vendedor pague de más o entre en pánico:
    // el período abierto todavía no se factura.
    const h = health();
    expect(h.overdueAmount + h.dueSoonAmount).toBe(200000);
  });
});

describe("dispatchBillingAlerts", () => {
  const notifier = () => ({ name: "test", notify: vi.fn().mockResolvedValue(undefined) });

  it("sends one notification per pending alert", async () => {
    const n = notifier();
    const h = billingHealth([period({ dueDate: "2026-09-13" })], TODAY);
    const sent = await dispatchBillingAlerts(n, "acc1", h);
    expect(n.notify).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it("does not repeat an alert that already went out", async () => {
    // Un "vence en 5 días" que llega cinco veces deja de leerse, y el día que
    // importa se ignora igual que los anteriores.
    const n = notifier();
    const h = billingHealth([period({ dueDate: "2026-09-14" })], TODAY);
    const sent = await dispatchBillingAlerts(n, "acc1", h, new Set(["2026-08-01:vence_pronto"]));
    expect(n.notify).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("still sends when the same invoice escalates to a different alert", async () => {
    const n = notifier();
    const h = billingHealth([period({ dueDate: "2026-09-12" })], TODAY);
    await dispatchBillingAlerts(n, "acc1", h, new Set(["2026-08-01:vence_pronto"]));
    expect(n.notify).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when there is nothing to warn about", async () => {
    const n = notifier();
    const h = billingHealth([period({ periodStatus: "OPEN" })], TODAY);
    expect(await dispatchBillingAlerts(n, "acc1", h)).toHaveLength(0);
    expect(n.notify).not.toHaveBeenCalled();
  });
});
