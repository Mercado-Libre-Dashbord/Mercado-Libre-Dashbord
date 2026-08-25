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

  it("returns an empty string for questions it doesn't recognize", () => {
    expect(draftAnswer("¿Es compatible con iPhone 15?", { price: 100, stock: 5 })).toBe("");
  });
});
