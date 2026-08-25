export type ChargeBucket = "comision" | "envio" | "impuesto" | "publicidad" | "otro";

export const BUCKET_LABEL: Record<ChargeBucket, string> = {
  comision: "Comisiones de venta",
  envio: "Envíos",
  impuesto: "Impuestos y percepciones",
  publicidad: "Publicidad",
  otro: "Otros cargos",
};

/**
 * Clasifica un cargo de la factura de Mercado Libre en un concepto legible.
 *
 * ML no expone un enum estable de conceptos: según el tipo de cargo el texto
 * llega en `detail_type`, `detail_sub_type` o `concept`, y en castellano o
 * inglés según el recurso. Por eso se clasifica por palabras clave sobre todo
 * lo que venga, y lo que no matchea cae en "otro" en vez de descartarse — un
 * cargo sin clasificar sigue siendo plata que salió y tiene que verse.
 */
export function classifyCharge(...fields: (string | null | undefined)[]): ChargeBucket {
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();

  if (/percep|retenc|impuesto|iva|iibb|ingresos brutos|ganancias|tax/.test(haystack)) return "impuesto";
  if (/env[ií]o|envios|shipping|mercado envios|flete|logisti/.test(haystack)) return "envio";
  if (/product ads|publicidad|advertis|campaign|ads/.test(haystack)) return "publicidad";
  if (/comisi[oó]n|comision|sale fee|selling fee|sales charge|cargo por venta|venta/.test(haystack)) return "comision";
  return "otro";
}
