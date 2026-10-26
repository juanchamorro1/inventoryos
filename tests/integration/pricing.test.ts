import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { exchangeRateFetches, exchangeRates, organizations, priceHistory, productVariants } from "@/server/db/schema";
import { withGlobalTx, withTenantTx } from "@/server/db/tx";
import { importProductRows } from "@/server/modules/catalog/csv";
import { createCategory, createProductWithVariants, getProduct, updateProduct } from "@/server/modules/catalog/service";
import { ExchangeProviderError, type ExchangeRateProvider } from "@/server/modules/exchange/providers";
import { refreshExchangeRate, todayBogota } from "@/server/modules/exchange/service";
import { postManualDocument } from "@/server/modules/inventory/service";
import {
  approvePriceChanges,
  ensurePricesCurrent,
  getPricingOverview,
  listPendingChanges,
  listPriceHistory,
  revertToAuto,
  setCategoryMargins,
  setManualPrice,
  setManualRate,
  updatePricingSettings,
} from "@/server/modules/pricing/service";
import { D } from "@/server/platform/decimal";
import type { TenantContext } from "@/server/platform/context";
import { createOrg, expectPgError, expectReject, memberCtx } from "./helpers";

const SETTINGS = { fxAdjustmentCop: "100", retailMargin: "30", wholesaleMargin: "20", extraCostPercent: "0", roundingStep: "100", roundingMode: "up", applyPolicy: "auto", rateMode: "manual", maxRateAgeHours: "48" };
const daysAgo = (n: number) => todayBogota(new Date(Date.now() - n * 86_400_000));

async function variantOf(ctx: TenantContext, variantId: string) {
  const [v] = await withTenantTx(ctx, (tx) => tx.select().from(productVariants).where(eq(productVariants.id, variantId)));
  return v!;
}

async function product(ctx: TenantContext, v: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const { variantIds } = await createProductWithVariants(ctx, { name: `Producto ${randomUUID().slice(0, 6)}`, variants: [{ lowStockThreshold: "0", ...v }], ...extra });
  return variantIds[0]!;
}

/** Empresa en modo manual con una TRM fija y política automática (cada prueba ajusta lo que necesita). */
async function pricedOrg(trm = "4000", overrides: Record<string, string> = {}) {
  const org = await createOrg("Precios");
  await updatePricingSettings(org.owner, { ...SETTINGS, ...overrides });
  await setManualRate(org.owner, { rate: trm, reason: "Prueba" });
  return org;
}

describe("conversión y cálculo de precios", () => {
  it("USD usa TRM + 100; COP no lleva ajuste; margen sobre el precio; redondeo al siguiente 100", async () => {
    const org = await pricedOrg("4000");
    const usd = await variantOf(org.owner, await product(org.owner, { costAmount: "100", costCurrency: "USD" }));
    expect(usd).toMatchObject({ pricingStatus: "ok", pricingRate: "4100.000000", pricingCostCop: "410000.000000", pricingTotalCost: "410000.000000" });
    // 410000 / 0.7 = 585714.2857 → 585800 ; 410000 / 0.8 = 512500 → 512500
    expect(usd).toMatchObject({ suggestedRetailPrice: "585714.2857", salePrice: "585800.0000", wholesalePrice: "512500.0000", retailPriceMode: "auto" });
    // El costo de referencia comercial queda en COP (no toca el costo contable del inventario).
    expect(usd.costPrice).toBe("410000.000000");

    const cop = await variantOf(org.owner, await product(org.owner, { costAmount: "410000", costCurrency: "COP" }));
    expect(cop).toMatchObject({ pricingRate: null, pricingCostCop: "410000.000000", salePrice: "585800.0000" });
  });

  it("gastos adicionales (porcentaje general + fijo por producto) y redondeo configurable", async () => {
    const org = await pricedOrg("4000", { extraCostPercent: "10", roundingStep: "1000", roundingMode: "nearest" });
    const v = await variantOf(org.owner, await product(org.owner, { costAmount: "100", costCurrency: "USD", extraCostCop: "5000" }));
    // 410000 × 1,10 + 5000 = 456000 → /0,7 = 651428,57 → 651000 (más cercano a 1000)
    expect(v).toMatchObject({ pricingTotalCost: "456000.000000", salePrice: "651000.0000" });
  });

  it("precedencia de márgenes: producto → categoría → general", async () => {
    const org = await pricedOrg("4000");
    const cat = await createCategory(org.owner, { name: "Premium" });
    await setCategoryMargins(org.owner, cat, { retailMargin: "50", wholesaleMargin: "" });
    const inCategory = await variantOf(org.owner, await product(org.owner, { costAmount: "1000" }, { categoryId: cat }));
    expect(inCategory).toMatchObject({ pricingRetailMargin: "50.0000", pricingWholesaleMargin: "20.0000", salePrice: "2000.0000" });
    const own = await variantOf(org.owner, await product(org.owner, { costAmount: "1000" }, { categoryId: cat, retailMargin: "60" }));
    expect(own).toMatchObject({ pricingRetailMargin: "60.0000", salePrice: "2500.0000" });
    await expectReject(setCategoryMargins(org.owner, cat, { retailMargin: "100" }), "ValidationError");
    await expectReject(updatePricingSettings(org.owner, { ...SETTINGS, retailMargin: "100" }), "ValidationError");
    await expectReject(updatePricingSettings(org.owner, { ...SETTINGS, wholesaleMargin: "-5" }), "ValidationError");
  });
});

describe("precios manuales, política y aprobación", () => {
  it("un precio manual no cambia al actualizar la tasa; el sugerido sí se actualiza", async () => {
    const org = await pricedOrg("4000");
    const id = await product(org.owner, { costAmount: "100", costCurrency: "USD" });
    await setManualPrice(org.owner, { variantId: id, kind: "retail", price: "700000", reason: "Precio de competencia" });
    await setManualRate(org.owner, { rate: "4500", reason: "Sube la TRM" });
    const v = await variantOf(org.owner, id);
    expect(v).toMatchObject({ retailPriceMode: "manual", salePrice: "700000.0000", pricingRate: "4600.000000" });
    // 460000 / 0,7 = 657142,8571 (sugerido actualizado), y el mayorista automático sí cambió.
    expect(v.suggestedRetailPrice).toBe("657142.8571");
    expect(v.wholesalePrice).toBe("575000.0000");
    const h = await listPriceHistory(org.owner, { variantId: id });
    expect(h.rows.find((r) => r.source === "manual")).toMatchObject({ kind: "retail", newPrice: "700000.0000", reason: "Precio de competencia", newMode: "manual" });
  });

  it("con política de aprobación los precios publicados no cambian hasta aprobar", async () => {
    const org = await pricedOrg("4000", { applyPolicy: "approval" });
    const a = await product(org.owner, { costAmount: "100", costCurrency: "USD" });
    const b = await product(org.owner, { costAmount: "200", costCurrency: "USD" });
    // El primer precio de un producto nuevo se publica al crearlo (no había precio que cambiar).
    expect((await variantOf(org.owner, a)).salePrice).toBe("585800.0000");
    await setManualRate(org.owner, { rate: "4400", reason: "Cambio de TRM" });
    expect((await variantOf(org.owner, a)).salePrice).toBe("585800.0000");
    const pending = await listPendingChanges(org.owner);
    expect(pending.total).toBe(2);
    expect(pending.rows.find((r) => r.variantId === a)).toMatchObject({ retailCurrent: "585800.0000", retailChanges: true });
    expect((await getPricingOverview(org.owner)).counts.pending).toBe(2);

    expect(await approvePriceChanges(org.owner, { variantIds: [a] })).toMatchObject({ variants: 1, prices: 2 });
    // 450000 / 0,7 = 642857,14 → 642900
    expect((await variantOf(org.owner, a)).salePrice).toBe("642900.0000");
    expect((await variantOf(org.owner, b)).salePrice).toBe("1171500.0000");
    expect((await listPendingChanges(org.owner)).total).toBe(1);
    await approvePriceChanges(org.owner, { variantIds: "all" });
    expect((await listPendingChanges(org.owner)).total).toBe(0);
    const h = await listPriceHistory(org.owner, { variantId: a });
    expect(h.rows.filter((r) => r.source === "approval")).toHaveLength(2);
  });

  it("volver a automático publica el sugerido según la política", async () => {
    const org = await pricedOrg("4000");
    const id = await product(org.owner, { costAmount: "1000", salePrice: "5000" });
    expect(await variantOf(org.owner, id)).toMatchObject({ retailPriceMode: "manual", salePrice: "5000.0000", suggestedRetailPrice: "1428.5714" });
    await revertToAuto(org.owner, { variantId: id, kind: "retail", reason: "Usar el margen general" });
    expect(await variantOf(org.owner, id)).toMatchObject({ retailPriceMode: "auto", salePrice: "1500.0000" });
    await expectReject(revertToAuto(org.owner, { variantId: id, kind: "retail", reason: "Otra vez" }), /ya está en modo automático/);
  });

  it("un precio por debajo del costo exige confirmación explícita", async () => {
    const org = await pricedOrg("4000");
    const id = await product(org.owner, { costAmount: "1000" });
    await expectReject(setManualPrice(org.owner, { variantId: id, kind: "wholesale", price: "900", reason: "Liquidación" }), /menor que su costo total/);
    expect((await variantOf(org.owner, id)).wholesalePriceMode).toBe("auto");
    await setManualPrice(org.owner, { variantId: id, kind: "wholesale", price: "900", reason: "Liquidación", acceptBelowCost: true });
    expect(await variantOf(org.owner, id)).toMatchObject({ wholesalePrice: "900.0000", wholesalePriceMode: "manual" });
    expect((await getPricingOverview(org.owner)).counts.belowCost).toBe(1);
  });

  it("editar el producto: vacío deja el precio automático, un valor lo fija y vaciarlo lo devuelve a automático", async () => {
    const org = await pricedOrg("4000");
    const { productId, variantIds } = await createProductWithVariants(org.owner, { name: "Editable", variants: [{ costAmount: "1000", lowStockThreshold: "0" }] });
    const id = variantIds[0]!;
    const edit = (v: Record<string, unknown>) => updateProduct(org.owner, productId, { name: "Editable", variants: [{ id, lowStockThreshold: "0", costAmount: "1000", ...v }] });
    await edit({ salePrice: "2000" });
    expect(await variantOf(org.owner, id)).toMatchObject({ retailPriceMode: "manual", salePrice: "2000.0000" });
    await edit({ salePrice: "2000", costAmount: "1200" });
    expect(await variantOf(org.owner, id)).toMatchObject({ salePrice: "2000.0000", suggestedRetailPrice: "1714.2857" });
    await edit({ salePrice: "", costAmount: "1200" });
    expect(await variantOf(org.owner, id)).toMatchObject({ retailPriceMode: "auto", salePrice: "1800.0000" });
    const sources = (await listPriceHistory(org.owner, { variantId: id })).rows.map((r) => r.source);
    expect(sources).toEqual(expect.arrayContaining(["manual", "revert"]));
  });
});

describe("tasas inválidas, obsoletas y fallos del proveedor", () => {
  it("sin tasa válida no se generan precios para USD; COP sigue funcionando y se conservan los últimos valores", async () => {
    const org = await createOrg("Sin tasa");
    await updatePricingSettings(org.owner, SETTINGS); // modo manual sin ninguna tasa registrada
    const usd = await variantOf(org.owner, await product(org.owner, { costAmount: "100", costCurrency: "USD" }));
    expect(usd).toMatchObject({ pricingStatus: "no_rate", salePrice: "0.0000", suggestedRetailPrice: null });
    const cop = await variantOf(org.owner, await product(org.owner, { costAmount: "1000" }));
    expect(cop).toMatchObject({ pricingStatus: "ok", salePrice: "1500.0000" });
    expect((await getPricingOverview(org.owner)).rate.status).toBe("missing");

    // Con tasa: se calcula. Luego una tasa obsoleta: se conservan los valores calculados.
    await setManualRate(org.owner, { rate: "4000", reason: "Llega la TRM" });
    const ok = await variantOf(org.owner, usd.id);
    expect(ok).toMatchObject({ pricingStatus: "ok", salePrice: "585800.0000" });
    await setManualRate(org.owner, { rate: "5000", validFrom: daysAgo(10), reason: "Tasa vieja" });
    expect((await getPricingOverview(org.owner)).rate.status).toBe("stale");
    const kept = await variantOf(org.owner, usd.id);
    expect(kept).toMatchObject({ pricingStatus: "no_rate", salePrice: "585800.0000", suggestedRetailPrice: "585714.2857", pricingRate: "4100.000000" });
  });

  it("valida la TRM manual (rango y fecha)", async () => {
    const org = await createOrg("TRM manual");
    for (const rate of ["0", "abc", "999", "25000"]) await expectReject(setManualRate(org.owner, { rate, reason: "Mal" }), "ValidationError");
    await expectReject(setManualRate(org.owner, { rate: "4000", validFrom: todayBogota(new Date(Date.now() + 3 * 86_400_000)), reason: "Futuro" }), "ValidationError");
    await expectReject(setManualRate(org.owner, { rate: "4000", reason: "" }), "ValidationError");
  });

  it("proveedor oficial: guarda la tasa válida, conserva la última ante errores, límites o saltos sospechosos", async () => {
    const quote = (rate: string, validFrom: string, validTo = validFrom) => async () => ({ rate: new D(rate), validFrom, validTo, raw: {} });
    const provider = (fetchLatest: ExchangeRateProvider["fetchLatest"]): ExchangeRateProvider => ({ id: "datos-gov-co-trm", label: "Prueba", attribution: "Prueba", fetchLatest });
    const refresh = (p: ExchangeRateProvider) => refreshExchangeRate({ trigger: "cron", force: true, provider: p });
    const yesterday = daysAgo(1);
    const today = todayBogota();

    expect(await refresh(provider(quote("4000", yesterday)))).toMatchObject({ status: "stored" });
    expect(await refresh(provider(quote("4000", yesterday)))).toMatchObject({ status: "unchanged" });
    expect(await refresh(provider(async () => Promise.reject(new ExchangeProviderError("El proveedor limitó las consultas (429).", "error"))))).toMatchObject({ status: "error" });
    expect(await refresh(provider(async () => Promise.reject(new ExchangeProviderError("TRM fuera del rango razonable.", "rejected"))))).toMatchObject({ status: "rejected" });
    expect(await refresh(provider(quote("6000", today)))).toMatchObject({ status: "rejected", message: expect.stringMatching(/Variación/) });
    expect(await refresh(provider(quote("3900", daysAgo(3))))).toMatchObject({ status: "rejected", message: expect.stringMatching(/anterior/) });

    const rates = await withGlobalTx((tx) => tx.select().from(exchangeRates));
    expect(rates.map((r) => r.rate)).toEqual(["4000.000000"]);
    const fetches = await withGlobalTx((tx) => tx.select({ status: exchangeRateFetches.status }).from(exchangeRateFetches));
    expect(fetches.map((f) => f.status)).toEqual(["stored", "unchanged", "error", "rejected", "rejected", "rejected"]);

    // Una empresa en modo automático toma la TRM oficial al abrir el catálogo (ensurePricesCurrent).
    const org = await createOrg("TRM oficial");
    await updatePricingSettings(org.owner, { ...SETTINGS, rateMode: "auto" });
    const id = await product(org.owner, { costAmount: "100", costCurrency: "USD" });
    expect((await variantOf(org.owner, id)).salePrice).toBe("585800.0000");
    expect(await refresh(provider(quote("4040", today)))).toMatchObject({ status: "stored" });
    const summary = await ensurePricesCurrent(org.owner);
    expect(summary).toMatchObject({ applied: 2 });
    expect(await ensurePricesCurrent(org.owner)).toBeNull();
    // 4140 × 100 / 0,7 = 591428,57 → 591500
    expect((await variantOf(org.owner, id)).salePrice).toBe("591500.0000");

    // Límite de consultas manuales (5 minutos).
    await refreshExchangeRate({ trigger: "manual", provider: provider(quote("4040", today)) });
    expect(await refreshExchangeRate({ trigger: "manual", provider: provider(quote("4040", today)) })).toMatchObject({ status: "skipped" });
  });

  it("las tablas de tasas e historial son de solo inserción para la aplicación", async () => {
    await expectPgError(withGlobalTx((tx) => tx.execute(sql`update exchange_rates set rate = 1`)), "42501");
    await expectPgError(withGlobalTx((tx) => tx.execute(sql`delete from exchange_rate_fetches`)), "42501");
    const org = await pricedOrg("4000");
    await product(org.owner, { costAmount: "1000" });
    await expectPgError(withTenantTx(org.owner, (tx) => tx.update(priceHistory).set({ reason: "x" })), "42501");
    await expectPgError(withTenantTx(org.owner, (tx) => tx.delete(priceHistory)), "42501");
  });
});

describe("integridad con el inventario", () => {
  it("cambiar tasas, costos y precios no crea movimientos ni toca el costo contable", async () => {
    const org = await pricedOrg("4000");
    const id = await product(org.owner, { costAmount: "100", costCurrency: "USD" });
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Compra", lines: [{ variantId: id, quantity: "3", unitCost: "400000" }] });
    const snapshot = () =>
      withTenantTx(org.owner, async (tx) => ({
        movements: (await tx.execute<{ n: number }>(sql`select count(*)::int as n from stock_movements`)).rows[0]!.n,
        documents: (await tx.execute<{ n: number }>(sql`select count(*)::int as n from stock_documents`)).rows[0]!.n,
        valuation: (await tx.execute<{ q: string; v: string }>(sql`select sum(quantity)::text as q, sum(total_value)::text as v from stock_valuations`)).rows[0],
      }));
    const before = await snapshot();
    await setManualRate(org.owner, { rate: "4800", reason: "Sube" });
    await setManualPrice(org.owner, { variantId: id, kind: "retail", price: "800000", reason: "Manual" });
    await updatePricingSettings(org.owner, { ...SETTINGS, retailMargin: "45" });
    expect(await snapshot()).toEqual(before);
    expect(before.valuation).toEqual({ q: "3.0000", v: "1200000.0000" });
  });
});

describe("aislamiento y permisos", () => {
  it("otra empresa no ve ni modifica precios, historial, tasas manuales ni configuración", async () => {
    const a = await pricedOrg("4000");
    const b = await pricedOrg("5000");
    const id = await product(a.owner, { costAmount: "1000" });
    await expectReject(setManualPrice(b.owner, { variantId: id, kind: "retail", price: "1", reason: "Intruso", acceptBelowCost: true }), "NotFoundError");
    await expectReject(revertToAuto(b.owner, { variantId: id, kind: "retail", reason: "Intruso" }), "NotFoundError");
    expect((await approvePriceChanges(b.owner, { variantIds: [id] })).prices).toBe(0);
    expect((await listPriceHistory(b.owner, { variantId: id })).total).toBe(0);
    expect((await getPricingOverview(b.owner)).rate.trm).toBe("5000.000000");
    expect((await getPricingOverview(a.owner)).rate.trm).toBe("4000.000000");
    expect((await variantOf(a.owner, id)).salePrice).toBe("1500.0000");
    // RLS: con el contexto de B la fila de A no existe.
    const rows = await withTenantTx(b.owner, (tx) => tx.select().from(priceHistory).where(eq(priceHistory.variantId, id)));
    expect(rows).toEqual([]);
  });

  it("solo pricing.manage configura, fija precios o aprueba; el personal y solo lectura no", async () => {
    const org = await pricedOrg("4000");
    // Plan con cupo para propietario + 3 miembros.
    await withTenantTx(org.owner, (tx) => tx.update(organizations).set({ plan: "pro" }).where(eq(organizations.id, org.organizationId)));
    const id = await product(org.owner, { costAmount: "1000" });
    for (const role of ["staff", "viewer"] as const) {
      const ctx = await memberCtx(org, role);
      await expectReject(updatePricingSettings(ctx, SETTINGS), "ForbiddenError");
      await expectReject(setManualRate(ctx, { rate: "4000", reason: "No" }), "ForbiddenError");
      await expectReject(setManualPrice(ctx, { variantId: id, kind: "retail", price: "1", reason: "No" }), "ForbiddenError");
      await expectReject(approvePriceChanges(ctx, { variantIds: "all" }), "ForbiddenError");
      expect((await getPricingOverview(ctx)).settings.retailMargin).toBe("30.0000");
    }
    const manager = await memberCtx(org, "manager");
    await setManualPrice(manager, { variantId: id, kind: "retail", price: "2000", reason: "Gerente" });
    expect((await getProduct(org.owner, (await variantOf(org.owner, id)).productId)).variants[0]!.salePrice).toBe("2000.0000");
  });
});

describe("importación por lotes", () => {
  it("valida, detecta duplicados, importa USD/COP con precios manuales o automáticos y no aplica nada si hay errores", async () => {
    const org = await pricedOrg("4000");
    const rows = [
      { producto: "Audífonos", sku: "AUD-1", moneda_costo: "USD", costo: "20", precio: "", precio_mayorista: "" },
      { producto: "Cable", sku: "CAB-1", moneda_costo: "COP", costo: "7.000", precio: "15000", minimo_mayorista: "10" },
      { producto: "Cargador", sku: "CAR-1", moneda_costo: "EUR", costo: "5" },
      { producto: "Cable", sku: "cab-1", costo: "1" },
    ];
    const bad = await importProductRows(org.owner, rows, { firstLine: 2 });
    expect(bad.applied).toBe(false);
    expect(bad.errors.map((e) => e.row).sort()).toEqual([4, 5]);
    expect(bad.errors.map((e) => e.message).join(" ")).toMatch(/moneda_costo.*|sku repetido/);

    const good = rows.slice(0, 2);
    const dry = await importProductRows(org.owner, good, { dryRun: true });
    expect(dry).toMatchObject({ applied: false, errors: [] });
    const applied = await importProductRows(org.owner, good, { firstLine: 2 });
    expect(applied).toMatchObject({ applied: true, created: 2 });
    const all = await withTenantTx(org.owner, (tx) => tx.select().from(productVariants));
    const aud = all.find((v) => v.sku === "AUD-1")!;
    const cab = all.find((v) => v.sku === "CAB-1")!;
    // 20 USD × 4100 = 82000 / 0,7 = 117142,86 → 117200
    expect(aud).toMatchObject({ costCurrency: "USD", retailPriceMode: "auto", salePrice: "117200.0000" });
    expect(cab).toMatchObject({ retailPriceMode: "manual", salePrice: "15000.0000", wholesaleMinQty: "10.0000", costAmount: "7000.000000" });

    // Reimportar: celdas vacías no cambian nada; "auto" vuelve a automático.
    await importProductRows(org.owner, [{ producto: "Cable", sku: "CAB-1", precio: "auto" }]);
    const cab2 = (await withTenantTx(org.owner, (tx) => tx.select().from(productVariants).where(eq(productVariants.id, cab.id))))[0]!;
    expect(cab2).toMatchObject({ retailPriceMode: "auto", salePrice: "10000.0000", costAmount: "7000.000000", wholesaleMinQty: "10.0000" });
  });

  it("límites de lote, precios bajo el costo y permisos", async () => {
    const org = await pricedOrg("4000");
    const big = Array.from({ length: 201 }, (_, i) => ({ producto: "P", sku: `S-${i}` }));
    expect((await importProductRows(org.owner, big)).errors[0]!.message).toMatch(/Máximo 200/);
    const below = await importProductRows(org.owner, [{ producto: "Bajo", sku: "BAJO-1", costo: "1000", precio: "500" }]);
    expect(below.applied).toBe(false);
    expect(below.errors[0]!.message).toMatch(/menor que su costo/);
    expect(await importProductRows(org.owner, [{ producto: "Bajo", sku: "BAJO-1", costo: "1000", precio: "500" }], { acceptBelowCost: true })).toMatchObject({ applied: true, errors: [] });
    const staff = await memberCtx(org, "staff");
    await expectReject(importProductRows(staff, [{ producto: "X", sku: "X-1" }]), "ForbiddenError");
    const manager = await memberCtx(org, "manager");
    expect(await importProductRows(manager, [{ producto: "Yoyo", sku: "Y-1", costo: "100" }])).toMatchObject({ applied: true, errors: [] });
  });
});
