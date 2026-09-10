export type ChargeBucket = "comision" | "envio" | "impuesto" | "publicidad" | "full" | "otro";

export const BUCKET_LABEL: Record<ChargeBucket, string> = {
  comision: "Comisiones de venta",
  envio: "Envíos",
  impuesto: "Impuestos y percepciones",
  publicidad: "Publicidad",
  full: "Mercado Envíos Full (almacenamiento y retiros)",
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

  // Va primero a propósito: "Incumplimiento de envíos" contiene la palabra
  // "envíos" y caía en el bucket "envio", como si fuera flete. Es una multa
  // por una entrega tardía o un producto agotado en Full, no un costo de
  // logística — mezclarlas hacía parecer que el gasto de envío era más alto
  // de lo real y escondía la penalidad en un bucket que no le corresponde.
  if (/incumplimiento|penalidad|multa/.test(haystack)) return "otro";
  // Va antes que "envio" a propósito: un cargo de depósito Full como "Envío a
  // Fulfillment" o "Retiro de stock Full" contiene la palabra "envío" y caía
  // en el bucket de flete de venta, mezclando logística de almacenamiento con
  // el costo de mandarle el pedido al comprador — son gastos de naturaleza
  // distinta y hay que poder verlos separados.
  if (/\bfull\b|fulfillment|almacenamiento|stock antiguo|permanencia en dep[oó]sito|retiro de stock/.test(haystack)) return "full";
  if (/percep|retenc|impuesto|iva|iibb|ingresos brutos|ganancias|tax/.test(haystack)) return "impuesto";
  if (/env[ií]o|envios|shipping|mercado envios|flete|logisti/.test(haystack)) return "envio";
  if (/product ads|publicidad|advertis|campaign|ads/.test(haystack)) return "publicidad";
  if (/comisi[oó]n|comision|sale fee|selling fee|sales charge|cargo por venta|venta/.test(haystack)) return "comision";
  return "otro";
}
