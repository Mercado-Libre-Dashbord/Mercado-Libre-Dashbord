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

  if (/mayorista|combo|por mayor/.test(q)) {
    return "Sí, trabajamos con pedidos por mayor — escribinos con la cantidad que te interesa y te pasamos precio especial.";
  }

  if (/precio|descuento|cuesta|vale/.test(q)) {
    return `El precio publicado es $${product.price.toFixed(2)}. Por ahora no tenemos descuentos adicionales sobre ese valor.`;
  }

  if (/retir|sucursal|local\b|punto de encuentro/.test(q)) {
    return "Por ahora coordinamos el retiro por mensaje privado una vez confirmada la compra — escribinos y vemos el punto que te quede mejor.";
  }

  if (/garant[ií]a/.test(q)) {
    return "El producto cuenta con la garantía legal establecida por defensa del consumidor. Ante cualquier falla, escribinos y lo resolvemos.";
  }

  if (/bater[ií]a|cargarl|autonom[ií]a|dura.*carga/.test(q)) {
    return "Podés ver el detalle de batería y autonomía en la ficha del producto. Si te queda alguna duda puntual, contanos y te confirmamos.";
  }

  if (/talle|color(?!.*factur)|medida|tama[ñn]o|variante/.test(q)) {
    return "Los talles/colores disponibles son los que ves publicados en la ficha. Si el que buscás no aparece, es que no tenemos stock de esa variante por ahora.";
  }

  if (/factura/.test(q)) {
    return "Sí, emitimos factura. Una vez confirmada la compra te la hacemos llegar por Mercado Libre.";
  }

  return "";
}
