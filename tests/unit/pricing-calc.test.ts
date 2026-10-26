import { describe, expect, it } from "vitest";
import { D } from "@/server/platform/decimal";
import { computePricing, isBelowCost, marginOf, priceForMargin, PricingInputError, resolveMargin, roundPrice } from "@/server/modules/pricing/calc";

const base = {
  costAmount: new D("100"),
  costCurrency: "USD" as const,
  extraCostCop: new D(0),
  extraCostPercent: new D(0),
  trm: new D("4000"),
  fxAdjustmentCop: new D("100"),
  retailMargin: new D("30"),
  wholesaleMargin: new D("20"),
};

describe("conversión USD → COP", () => {
  it("tasa aplicada = TRM + 100 solo para costos en USD", () => {
    const r = computePricing(base);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.rateApplied!.toString()).toBe("4100");
    expect(r.costCop.toString()).toBe("410000");
    expect(r.totalCost.toString()).toBe("410000");
  });

  it("un costo en COP no recibe el ajuste cambiario (ni usa la TRM)", () => {
    const r = computePricing({ ...base, costCurrency: "COP", costAmount: new D("410000"), trm: null });
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.rateApplied).toBeNull();
    expect(r.costCop.toString()).toBe("410000");
    // Mismo costo en COP que el producto en USD anterior: mismo sugerido, sin sumar otra vez 100.
    const usd = computePricing(base);
    expect(usd.status === "ok" && r.retailSuggested.eq(usd.retailSuggested)).toBe(true);
  });

  it("el ajuste es configurable y puede ser cero", () => {
    const r = computePricing({ ...base, fxAdjustmentCop: new D("0") });
    expect(r.status === "ok" && r.costCop.toString()).toBe("400000");
    const r2 = computePricing({ ...base, fxAdjustmentCop: new D("250") });
    expect(r2.status === "ok" && r2.rateApplied!.toString()).toBe("4250");
  });

  it("sin TRM válida no calcula nada (nunca con cero ni negativos)", () => {
    for (const trm of [null, new D(0), new D(-1)]) expect(computePricing({ ...base, trm }).status).toBe("no_rate");
  });

  it("aritmética decimal exacta (sin errores de punto flotante)", () => {
    const r = computePricing({ ...base, costAmount: new D("0.1"), trm: new D("0.2"), fxAdjustmentCop: new D("0"), retailMargin: new D("0"), wholesaleMargin: new D("0") });
    expect(r.status === "ok" && r.costCop.toString()).toBe("0.02");
    const r2 = computePricing({ ...base, costAmount: new D("19.99"), trm: new D("3958.43") });
    // 19.99 × 4058.43 = 81128.0157
    expect(r2.status === "ok" && r2.costCop.toString()).toBe("81128.0157");
  });
});

describe("gastos adicionales", () => {
  it("porcentaje sobre el costo convertido más gastos fijos en COP", () => {
    const r = computePricing({ ...base, extraCostPercent: new D("10"), extraCostCop: new D("5000") });
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.extraCost.toString()).toBe("46000");
    expect(r.totalCost.toString()).toBe("456000");
  });
  it("rechaza costos o gastos negativos", () => {
    expect(() => computePricing({ ...base, costAmount: new D(-1) })).toThrow(PricingInputError);
    expect(() => computePricing({ ...base, extraCostCop: new D(-1) })).toThrow(PricingInputError);
  });
});

describe("márgenes sobre el precio de venta", () => {
  it("precio = costo / (1 − margen/100), no costo + margen", () => {
    expect(priceForMargin(new D(70), new D(30)).toString()).toBe("100");
    expect(priceForMargin(new D(410000), new D(30)).toString()).toBe("585714.2857");
    expect(marginOf(new D(100), new D(70))!.toString()).toBe("30");
  });
  it("límites: 0 ≤ margen < 100", () => {
    expect(priceForMargin(new D(100), new D(0)).toString()).toBe("100");
    expect(priceForMargin(new D(1), new D("99.99")).toString()).toBe("10000");
    for (const m of ["100", "100.5", "-0.01"]) expect(() => priceForMargin(new D(1), new D(m))).toThrow(PricingInputError);
    expect(() => computePricing({ ...base, wholesaleMargin: new D(100) })).toThrow(/mayorista/);
  });
  it("precedencia explícita: producto → categoría → general", () => {
    expect(resolveMargin(new D(40), new D(50), new D(30))).toMatchObject({ source: "product" });
    expect(resolveMargin(null, new D(50), new D(30))).toMatchObject({ source: "category" });
    expect(resolveMargin(null, null, new D(30)).value.toString()).toBe("30");
    // Un margen 0 explícito del producto también tiene prioridad.
    expect(resolveMargin(new D(0), new D(50), new D(30)).value.toString()).toBe("0");
  });
  it("detecta precios por debajo del costo", () => {
    expect(isBelowCost(new D(99), new D(100))).toBe(true);
    expect(isBelowCost(new D(100), new D(100))).toBe(false);
  });
});

describe("redondeo del precio publicado", () => {
  const v = new D("585714.2857");
  it("al siguiente múltiplo de 100 (predeterminado)", () => {
    expect(roundPrice(v, new D(100), "up").toString()).toBe("585800");
    expect(roundPrice(new D("585800"), new D(100), "up").toString()).toBe("585800");
    expect(roundPrice(new D("585800.0001"), new D(100), "up").toString()).toBe("585900");
  });
  it("al múltiplo más cercano, otros pasos y sin redondeo", () => {
    expect(roundPrice(v, new D(100), "nearest").toString()).toBe("585700");
    expect(roundPrice(v, new D(1000), "up").toString()).toBe("586000");
    expect(roundPrice(v, new D(50), "nearest").toString()).toBe("585700");
    expect(roundPrice(v, new D(100), "none").toString()).toBe("585714.29");
  });
  it("rechaza pasos no positivos", () => {
    expect(() => roundPrice(v, new D(0), "up")).toThrow(PricingInputError);
  });
});
