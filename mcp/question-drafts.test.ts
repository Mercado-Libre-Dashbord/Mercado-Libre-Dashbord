import { describe, it, expect } from "vitest";
import { draftAnswer } from "./question-drafts";

describe("draftAnswer", () => {
  it("answers stock questions when there is stock", () => {
    expect(draftAnswer("¿Tienen stock?", { price: 100, stock: 5 })).toBe(
      "Sí, tenemos stock disponible (5 unidades)."
    );
  });

  it("answers stock questions when there is no stock", () => {
    expect(draftAnswer("¿Queda alguno?", { price: 100, stock: 0 })).toBe(
      "Por el momento no tenemos stock. Dejanos tu contacto y te avisamos apenas repongamos."
    );
  });

  it("answers shipping questions", () => {
    expect(draftAnswer("¿Cuándo llega si compro hoy?", { price: 100, stock: 5 })).toContain("envío");
  });

  it("answers price questions", () => {
    expect(draftAnswer("¿Hacen descuento?", { price: 199.5, stock: 5 })).toBe(
      "El precio publicado es $199.50. Por ahora no tenemos descuentos adicionales sobre ese valor."
    );
  });

  it("answers pickup questions", () => {
    expect(draftAnswer("¿Puedo retirar por local?", { price: 100, stock: 5 })).toContain("retiro");
  });

  it("answers warranty questions", () => {
    expect(draftAnswer("¿Tiene garantía?", { price: 100, stock: 5 })).toContain("garantía");
  });

  it("answers battery/charging questions", () => {
    expect(draftAnswer("¿Cuánto dura la batería cargada?", { price: 100, stock: 5 })).toContain("batería");
  });

  it("answers size/color/variant questions", () => {
    expect(draftAnswer("¿Viene en otro color?", { price: 100, stock: 5 })).toContain("talles/colores");
  });

  it("answers invoice questions", () => {
    expect(draftAnswer("¿Hacen factura A?", { price: 100, stock: 5 })).toContain("factura");
  });

  it("answers wholesale questions", () => {
    expect(draftAnswer("¿Tenés precio por mayor?", { price: 100, stock: 5 })).toContain("mayor");
  });

  it("returns an empty string for questions it doesn't recognize", () => {
    expect(draftAnswer("¿Es compatible con iPhone 15?", { price: 100, stock: 5 })).toBe("");
  });
});
