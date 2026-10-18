import { describe, expect, it } from "vitest";
import { avgOf, inboundAtUnitCost, outboundAtAverage, outboundAtTotal, type ValuationState } from "@/server/modules/costing/average";
import { dec, ZERO } from "@/server/platform/decimal";

const empty: ValuationState = { quantity: ZERO, value: ZERO };

describe("promedio ponderado móvil", () => {
  it("recalcula el promedio en cada entrada", () => {
    const a = inboundAtUnitCost(empty, dec(10), dec(100));
    expect(a.state.value.toString()).toBe("1000");
    expect(a.avgCost.toString()).toBe("100");
    const b = inboundAtUnitCost(a.state, dec(5), dec(130));
    expect(b.state.quantity.toString()).toBe("15");
    expect(b.state.value.toString()).toBe("1650");
    expect(b.avgCost.toString()).toBe("110");
  });

  it("las salidas no cambian el promedio y usan el costo vigente", () => {
    const s = inboundAtUnitCost(empty, dec(3), dec(100)).state;
    const out = outboundAtAverage(s, dec(1));
    expect(out.totalCost.toString()).toBe("100");
    expect(avgOf(out.state).toString()).toBe("100");
  });

  it("al agotar la existencia el valor queda exactamente en cero (absorbe el redondeo)", () => {
    // 3 unidades por 100 → promedio 33.333333
    const s = inboundAtUnitCost(empty, dec(3), dec("33.333333")).state;
    const s2 = inboundAtUnitCost(s, dec(0.0001), dec(1)).state;
    let state = s2;
    state = outboundAtAverage(state, dec(1)).state;
    state = outboundAtAverage(state, dec(1)).state;
    const last = outboundAtAverage(state, dec("1.0001"));
    expect(last.state.quantity.isZero()).toBe(true);
    expect(last.state.value.isZero()).toBe(true);
  });

  it("rechaza salidas mayores a la existencia", () => {
    const s = inboundAtUnitCost(empty, dec(1), dec(10)).state;
    expect(() => outboundAtAverage(s, dec(2))).toThrow();
  });

  it("salida a costo específico: no permite dejar valor negativo", () => {
    let s = inboundAtUnitCost(empty, dec(10), dec(100)).state; // 1000
    s = outboundAtAverage(s, dec(9)).state; // queda 1 por 100
    s = inboundAtUnitCost(s, dec(1), dec(10)).state; // 2 unidades, valor 110
    // Reversar una entrada de 1 unidad a 200 dejaría -90
    expect(() => outboundAtTotal(s, dec(1), dec(200))).toThrow(/negativo/);
  });

  it("propiedad: con secuencias aleatorias, valor ≥ 0, Q=0 ⇒ V=0 y se conserva el costo", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 200; run++) {
      let state = empty;
      let inCost = ZERO;
      let outCost = ZERO;
      for (let step = 0; step < 60; step++) {
        if (rand() < 0.55 || state.quantity.isZero()) {
          const q = dec(Math.floor(rand() * 20) + 1);
          const c = dec((rand() * 1000).toFixed(6));
          const r = inboundAtUnitCost(state, q, c);
          inCost = inCost.plus(r.totalCost);
          state = r.state;
        } else {
          const max = state.quantity.toNumber();
          const q = dec(Math.max(1, Math.floor(rand() * max)));
          const r = outboundAtAverage(state, q.gt(state.quantity) ? state.quantity : q);
          outCost = outCost.plus(r.totalCost);
          state = r.state;
        }
        expect(state.value.gte(0)).toBe(true);
        if (state.quantity.isZero()) expect(state.value.isZero()).toBe(true);
        // Conservación: lo que entró = lo que salió + lo que queda.
        expect(inCost.minus(outCost).minus(state.value).isZero()).toBe(true);
      }
    }
  });
});
