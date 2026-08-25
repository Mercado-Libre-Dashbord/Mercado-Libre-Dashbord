// Genera una respuesta sugerida a partir de reglas simples sobre palabras clave
// — sin IA, sin costo, sin dependencia nueva. Si no reconoce el patrón de la
// pregunta devuelve "", así el vendedor la escribe él mismo desde cero.
export interface DraftProductInfo {
  price: number;
  stock: number;
}

export function draftAnswer(questionText: string, product: DraftProductInfo): string {
  const q = questionText.toLowerCase();

  if (/\bstock\b|queda|disponible|hay\s/.test(q)) {
    return product.stock > 0
      ? `Sí, tenemos stock disponible (${product.stock} unidades).`
      : "Por el momento no tenemos stock. Dejanos tu contacto y te avisamos apenas repongamos.";
  }

  if (/env[ií]o|llega|demora|cuando.*lleg/.test(q)) {
    return "El tiempo de envío se calcula automáticamente en la publicación según tu ubicación. Una vez confirmada la compra lo despachamos a la brevedad.";
  }

  if (/precio|descuento|cuesta|vale/.test(q)) {
    return `El precio publicado es $${product.price.toFixed(2)}. Por ahora no tenemos descuentos adicionales sobre ese valor.`;
  }

  return "";
}
