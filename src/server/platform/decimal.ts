import Decimal from "decimal.js";

// Aritmética decimal exacta. Nunca convertir cantidades o dinero a Number.
// Regla de redondeo: ROUND_HALF_UP (validar con contador; ver docs/architecture.md#costeo).
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const QTY_SCALE = 4;
export const COST_SCALE = 6;
export const MONEY_SCALE = 4;

export const dec = (v: Decimal.Value | Dec) => new D(v);
export const ZERO = new D(0);

export const roundQty = (v: Dec) => v.toDecimalPlaces(QTY_SCALE);
export const roundCost = (v: Dec) => v.toDecimalPlaces(COST_SCALE);
export const roundMoney = (v: Dec) => v.toDecimalPlaces(MONEY_SCALE);

/** Serializa para columnas numeric (string con escala fija). */
export const qtyStr = (v: Dec) => roundQty(v).toFixed(QTY_SCALE);
export const costStr = (v: Dec) => roundCost(v).toFixed(COST_SCALE);
export const moneyStr = (v: Dec) => roundMoney(v).toFixed(MONEY_SCALE);
export const rateStr = (v?: Dec) => (v ?? ZERO).toDecimalPlaces(4).toFixed(4);

/** Valida y normaliza un texto decimal ingresado por el usuario ("1.234,5" no se acepta; usar punto). */
export function parseDecimal(input: string, opts: { scale: number; min?: number; allowZero?: boolean } = { scale: 4 }): Dec | null {
  const s = input.trim().replace(/\s/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = new D(s);
  if (v.decimalPlaces() > opts.scale) return null;
  if (opts.min !== undefined && v.lt(opts.min)) return null;
  if (opts.allowZero === false && v.isZero()) return null;
  return v;
}
