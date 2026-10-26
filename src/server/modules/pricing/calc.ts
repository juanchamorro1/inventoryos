import { D, type Dec, ZERO } from "../../platform/decimal";

// Cálculo de costos y precios comerciales. Funciones puras con aritmética decimal exacta (decimal.js):
// nunca se usa Number ni punto flotante binario para dinero.
//
//   Tasa aplicada      = TRM (COP por USD) + ajuste          (solo si el costo original está en USD)
//   Costo en COP       = costo original × tasa aplicada      (o el mismo valor si ya está en COP)
//   Costo total        = costo en COP × (1 + gastos % / 100) + gastos fijos en COP
//   Precio sugerido    = costo total / (1 − margen / 100)    (margen SOBRE EL PRECIO de venta, 0 ≤ margen < 100)
//   Precio publicado   = precio sugerido redondeado según la regla (p. ej. al siguiente múltiplo de 100)

export type Currency = "COP" | "USD";
export type RoundingMode = "up" | "nearest" | "none";

export type MarginSource = "product" | "category" | "general";

export type PricingInput = {
  costAmount: Dec;
  costCurrency: Currency;
  extraCostCop: Dec;
  extraCostPercent: Dec;
  /** TRM vigente en COP/USD (sin ajuste); null si no hay una tasa válida. */
  trm: Dec | null;
  fxAdjustmentCop: Dec;
  retailMargin: Dec;
  wholesaleMargin: Dec;
};

export type PricingResult =
  | { status: "no_rate" }
  | {
      status: "ok";
      /** Tasa aplicada (TRM + ajuste) o null si el costo ya estaba en COP. */
      rateApplied: Dec | null;
      costCop: Dec;
      extraCost: Dec;
      totalCost: Dec;
      retailSuggested: Dec;
      wholesaleSuggested: Dec;
    };

export class PricingInputError extends Error {}

/** Valida un margen sobre el precio de venta: 0 ≤ margen < 100. */
export function assertMargin(m: Dec, label = "El margen") {
  if (!m.isFinite() || m.lt(0) || m.gte(100)) throw new PricingInputError(`${label} debe ser mayor o igual a 0 y menor que 100.`);
}

/** Margen efectivo con precedencia explícita: producto → categoría → configuración general. */
export function resolveMargin(product: Dec | null, category: Dec | null, general: Dec): { value: Dec; source: MarginSource } {
  if (product !== null) return { value: product, source: "product" };
  if (category !== null) return { value: category, source: "category" };
  return { value: general, source: "general" };
}

export function appliedRate(trm: Dec, adjustment: Dec): Dec {
  return trm.plus(adjustment);
}

/** Precio que deja `margin` % del precio de venta: costo / (1 − margen/100). Sin redondear (4 decimales). */
export function priceForMargin(totalCost: Dec, margin: Dec): Dec {
  assertMargin(margin);
  return totalCost.div(new D(1).minus(margin.div(100))).toDecimalPlaces(4, D.ROUND_HALF_UP);
}

/** Redondeo del precio publicado. "up" = siguiente múltiplo del paso (100 por defecto). */
export function roundPrice(value: Dec, step: Dec, mode: RoundingMode): Dec {
  if (mode === "none") return value.toDecimalPlaces(2, D.ROUND_HALF_UP);
  if (!step.isFinite() || step.lte(0)) throw new PricingInputError("El paso de redondeo debe ser mayor que cero.");
  const units = value.div(step);
  const rounded = mode === "up" ? units.ceil() : units.toDecimalPlaces(0, D.ROUND_HALF_UP);
  return rounded.times(step);
}

export function computePricing(input: PricingInput): PricingResult {
  if (input.costAmount.lt(0) || input.extraCostCop.lt(0) || input.extraCostPercent.lt(0)) throw new PricingInputError("Los costos no pueden ser negativos.");
  assertMargin(input.retailMargin, "El margen minorista");
  assertMargin(input.wholesaleMargin, "El margen mayorista");
  let rateApplied: Dec | null = null;
  let costCop: Dec;
  if (input.costCurrency === "USD") {
    // Sin TRM válida no se calcula nada (nunca con cero ni con datos inválidos).
    if (!input.trm || !input.trm.isFinite() || input.trm.lte(0)) return { status: "no_rate" };
    if (input.fxAdjustmentCop.lt(0)) throw new PricingInputError("El ajuste cambiario no puede ser negativo.");
    rateApplied = appliedRate(input.trm, input.fxAdjustmentCop);
    costCop = input.costAmount.times(rateApplied).toDecimalPlaces(6, D.ROUND_HALF_UP);
  } else {
    // Costo ya en COP: el ajuste cambiario NO se aplica.
    costCop = input.costAmount.toDecimalPlaces(6, D.ROUND_HALF_UP);
  }
  const extraCost = costCop.times(input.extraCostPercent).div(100).plus(input.extraCostCop).toDecimalPlaces(6, D.ROUND_HALF_UP);
  const totalCost = costCop.plus(extraCost);
  return {
    status: "ok",
    rateApplied,
    costCop,
    extraCost,
    totalCost,
    retailSuggested: priceForMargin(totalCost, input.retailMargin),
    wholesaleSuggested: priceForMargin(totalCost, input.wholesaleMargin),
  };
}

/** Margen real sobre el precio de venta (para advertencias): (precio − costo) / precio × 100. */
export function marginOf(price: Dec, totalCost: Dec): Dec | null {
  if (price.lte(0)) return null;
  return price.minus(totalCost).div(price).times(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export const isBelowCost = (price: Dec | null, totalCost: Dec | null) => Boolean(price && totalCost && price.lt(totalCost));

export { ZERO };
