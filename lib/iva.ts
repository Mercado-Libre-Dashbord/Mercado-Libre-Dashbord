/**
 * IVA para vendedores Responsables Inscriptos (Argentina).
 *
 * Está estandarizado a propósito, sin configuración por cuenta: el vendedor
 * típico de esta app es Responsable Inscripto con alícuota general del 21%.
 * Si algún día hace falta soportar Monotributo o exento, esto se vuelve un
 * campo en `accounts` — pero mientras el 100% de los casos sea RI, un campo
 * configurable es una perilla más para equivocarse, no una función.
 *
 * Cómo funciona (y por qué el IVA sí es un costo real que hay que restar):
 * el precio publicado en Mercado Libre YA incluye IVA. De cada $121 que
 * cobrás, $21 no son tuyos: son débito fiscal que le debés a AFIP. Contra eso
 * descontás el crédito fiscal del IVA que ya pagaste en la comisión de ML, el
 * envío, la publicidad y el costo del producto. Lo que queda —débito menos
 * crédito— sale de tu bolsillo, y hasta ahora la app no lo estaba restando.
 */
export const IVA_RATE = 0.21;

/** De un importe CON IVA, cuánto es IVA. Ej: 121 → 21. */
export function ivaFromGross(grossAmount: number): number {
  return grossAmount * (IVA_RATE / (1 + IVA_RATE));
}

/** De un importe CON IVA, cuánto es neto. Ej: 121 → 100. */
export function netFromGross(grossAmount: number): number {
  return grossAmount / (1 + IVA_RATE);
}

export interface IvaBalanceInput {
  /** Facturación bruta de la venta (precio publicado × cantidad). */
  grossRevenue: number;
  /** Cargos de ML que vienen con IVA incluido y generan crédito fiscal. */
  mlCharges: number;
  /** Costo del producto. Se asume comprado con factura A (con IVA). */
  productCost: number;
}

/**
 * IVA que efectivamente le pagás a AFIP por esta venta: débito − crédito.
 *
 * Restar esto es matemáticamente idéntico a calcular toda la rentabilidad en
 * valores netos (sin IVA); se expone como una línea aparte porque es mucho
 * más fácil de entender —"esto se va en IVA"— que ver todos los demás
 * números divididos por 1,21.
 */
export function ivaBalance(input: IvaBalanceInput): number {
  const debito = ivaFromGross(input.grossRevenue);
  const credito = ivaFromGross(input.mlCharges) + ivaFromGross(input.productCost);
  return debito - credito;
}
