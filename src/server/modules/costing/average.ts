import { dec, roundCost, roundMoney, ZERO, type Dec } from "../../platform/decimal";

// Costo promedio ponderado móvil (perpetuo) por (variante, bodega).
// El valor total es la fuente de verdad; el promedio se deriva: avg = valor / cantidad.
//
//   Entrada (q, costo total C):  Q' = Q + q ;  V' = V + C ;  avg' = V' / Q'
//   Salida  (q) al promedio:     C = round(q · avg, 4) ;  V' = V − C ;  avg sin cambio
//   Si Q' = 0 → V' = 0: el residuo de redondeo se asigna a esa salida.

export type ValuationState = { quantity: Dec; value: Dec };

export type CostResult = { state: ValuationState; totalCost: Dec; unitCost: Dec; avgCost: Dec };

export class CostingError extends Error {}

export const avgOf = (s: ValuationState): Dec => (s.quantity.gt(0) ? roundCost(s.value.div(s.quantity)) : ZERO);

export function inbound(state: ValuationState, quantity: Dec, totalCost: Dec): CostResult {
  if (quantity.lte(0)) throw new CostingError("La cantidad de entrada debe ser positiva.");
  if (totalCost.lt(0)) throw new CostingError("El costo de entrada no puede ser negativo.");
  const next = { quantity: state.quantity.plus(quantity), value: roundMoney(state.value.plus(totalCost)) };
  return { state: next, totalCost: roundMoney(totalCost), unitCost: roundCost(totalCost.div(quantity)), avgCost: avgOf(next) };
}

export function inboundAtUnitCost(state: ValuationState, quantity: Dec, unitCost: Dec): CostResult {
  return inbound(state, quantity, roundMoney(quantity.times(unitCost)));
}

/** Salida al costo promedio vigente. */
export function outboundAtAverage(state: ValuationState, quantity: Dec): CostResult {
  if (quantity.lte(0)) throw new CostingError("La cantidad de salida debe ser positiva.");
  if (quantity.gt(state.quantity)) throw new CostingError("Cantidad insuficiente para valorar la salida.");
  const remaining = state.quantity.minus(quantity);
  const totalCost = remaining.isZero() ? state.value : roundMoney(quantity.times(avgOf(state)));
  const next = { quantity: remaining, value: roundMoney(state.value.minus(totalCost)) };
  return { state: next, totalCost, unitCost: roundCost(totalCost.div(quantity)), avgCost: avgOf(next) };
}

/**
 * Salida a un costo total específico (p. ej. reverso de una recepción al costo original).
 * Si se agota la cantidad, la salida absorbe todo el valor restante para mantener Q = 0 ⇒ V = 0.
 */
export function outboundAtTotal(state: ValuationState, quantity: Dec, totalCost: Dec): CostResult {
  if (quantity.lte(0)) throw new CostingError("La cantidad de salida debe ser positiva.");
  if (quantity.gt(state.quantity)) throw new CostingError("Cantidad insuficiente para valorar la salida.");
  const remaining = state.quantity.minus(quantity);
  const cost = remaining.isZero() ? state.value : roundMoney(totalCost);
  const value = roundMoney(state.value.minus(cost));
  if (value.lt(0)) {
    throw new CostingError(
      "La operación dejaría un valor de inventario negativo (el costo original supera el valor actual). Registre un ajuste en su lugar.",
    );
  }
  const next = { quantity: remaining, value };
  return { state: next, totalCost: cost, unitCost: roundCost(cost.div(quantity)), avgCost: avgOf(next) };
}

export const toState = (quantity: string, value: string): ValuationState => ({ quantity: dec(quantity), value: dec(value) });
