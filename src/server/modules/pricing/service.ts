import "server-only";
import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { categories, manualExchangeRates, organizations, priceHistory, pricingSettings, productVariants, products, users } from "../../db/schema";
import { withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { D, type Dec } from "../../platform/decimal";
import { ConflictError, NotFoundError, ValidationError } from "../../platform/errors";
import { can, requirePermission } from "../../platform/permissions";
import { parseOrThrow, zMoney, zUuid } from "../../platform/validation";
import { latestOfficialRate, refreshExchangeRate, todayBogota, type RefreshResult } from "../exchange/service";
import { PROVIDERS } from "../exchange/providers";
import { computePricing, isBelowCost, resolveMargin, roundPrice, type RoundingMode } from "./calc";

// Precios comerciales: configuración, tasa efectiva, recálculo, política de publicación, precios manuales e historial.
//
// Reglas clave:
//   - El precio minorista publicado es product_variants.sale_price (el que usa Ventas); el mayorista, wholesale_price.
//   - Un precio en modo MANUAL nunca lo cambia un recálculo: solo se actualiza su sugerido.
//   - Un precio AUTOMÁTICO cambia según la política: "auto" lo publica de inmediato; "approval" lo deja pendiente
//     (vista previa) hasta que alguien con pricing.manage lo apruebe.
//   - Sin tasa válida (o con tasa obsoleta) los productos en USD no se recalculan: se conservan los últimos valores.
//   - Nada de esto toca el inventario: no hay movimientos, ni cambios en stock_valuations ni en documentos.

export const DEFAULT_SETTINGS = {
  fxAdjustmentCop: "100",
  retailMargin: "30",
  wholesaleMargin: "20",
  extraCostPercent: "0",
  roundingStep: "100",
  roundingMode: "up" as RoundingMode,
  applyPolicy: "approval" as "auto" | "approval",
  rateMode: "auto" as "auto" | "manual",
  maxRateAgeHours: 48,
  lastRateKey: null as string | null,
  updatedAt: null as Date | null,
};
export type PricingSettings = typeof DEFAULT_SETTINGS;

export async function settingsTx(tx: Tx, organizationId: string): Promise<PricingSettings> {
  const [row] = await tx.select().from(pricingSettings).where(eq(pricingSettings.organizationId, organizationId));
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    fxAdjustmentCop: row.fxAdjustmentCop,
    retailMargin: row.retailMargin,
    wholesaleMargin: row.wholesaleMargin,
    extraCostPercent: row.extraCostPercent,
    roundingStep: row.roundingStep,
    roundingMode: row.roundingMode,
    applyPolicy: row.applyPolicy,
    rateMode: row.rateMode,
    maxRateAgeHours: row.maxRateAgeHours,
    lastRateKey: row.lastRateKey,
    updatedAt: row.updatedAt,
  };
}

// ---------- Tasa efectiva ----------

export type EffectiveRate = {
  /** ok: se puede usar · stale: obsoleta (no se usa) · missing: no hay ninguna · unsupported: la empresa no opera en COP */
  status: "ok" | "stale" | "missing" | "unsupported";
  mode: "auto" | "manual";
  trm: string | null;
  applied: string | null;
  adjustment: string;
  source: string | null;
  attribution: string | null;
  validFrom: string | null;
  validTo: string | null;
  recordedAt: Date | null;
  /** Identifica la tasa con la que se calcularon los precios (cambia cuando hay una tasa nueva). */
  key: string | null;
  message: string;
};

/** Fin del día `date` en Bogotá (UTC−5, sin horario de verano). */
const endOfDayBogota = (date: string) => new Date(`${date}T23:59:59.999-05:00`);

export async function effectiveRateTx(tx: Tx, organizationId: string, settings: PricingSettings, now = new Date()): Promise<EffectiveRate> {
  const [org] = await tx.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, organizationId));
  const base = { mode: settings.rateMode, adjustment: settings.fxAdjustmentCop, attribution: null, applied: null } as const;
  if (org?.currency !== "COP") {
    return { ...base, status: "unsupported", trm: null, source: null, validFrom: null, validTo: null, recordedAt: null, key: null, message: "La conversión USD→COP solo está disponible para empresas que operan en COP." };
  }
  const graceMs = settings.maxRateAgeHours * 3_600_000;
  const withApplied = (r: Omit<EffectiveRate, "applied">): EffectiveRate => ({ ...r, applied: r.trm ? new D(r.trm).plus(settings.fxAdjustmentCop).toFixed(2) : null });
  if (settings.rateMode === "manual") {
    const [m] = await tx
      .select()
      .from(manualExchangeRates)
      .where(eq(manualExchangeRates.organizationId, organizationId))
      .orderBy(desc(manualExchangeRates.createdAt))
      .limit(1);
    if (!m) return withApplied({ ...base, status: "missing", trm: null, source: "manual", validFrom: null, validTo: null, recordedAt: null, key: null, message: "Modo manual sin ninguna tasa registrada." });
    const stale = now.getTime() > endOfDayBogota(m.validFrom).getTime() + graceMs;
    return withApplied({
      ...base,
      status: stale ? "stale" : "ok",
      trm: m.rate,
      source: "manual",
      validFrom: m.validFrom,
      validTo: null,
      recordedAt: m.createdAt,
      key: `manual:${m.id}`,
      message: stale ? `La tasa manual del ${m.validFrom} superó las ${settings.maxRateAgeHours} h de vigencia. Registra una nueva.` : `Tasa manual registrada el ${m.validFrom}.`,
    });
  }
  const r = await latestOfficialRate(tx);
  if (!r) return withApplied({ ...base, status: "missing", trm: null, source: null, validFrom: null, validTo: null, recordedAt: null, key: null, message: "Todavía no se ha obtenido ninguna TRM. Consulta la tasa o registra una manualmente." });
  const stale = now.getTime() > endOfDayBogota(r.validTo).getTime() + graceMs;
  return withApplied({
    ...base,
    status: stale ? "stale" : "ok",
    trm: r.rate,
    source: r.provider,
    attribution: PROVIDERS[r.provider]?.attribution ?? null,
    validFrom: r.validFrom,
    validTo: r.validTo,
    recordedAt: r.fetchedAt,
    key: `auto:${r.id}`,
    message: stale
      ? `La última TRM (vigente hasta el ${r.validTo}) está obsoleta. No se generan precios nuevos para productos en USD hasta tener una tasa válida.`
      : `TRM vigente del ${r.validFrom} al ${r.validTo}.`,
  });
}

// ---------- Recálculo ----------

/** Redondeo del sugerido en SQL (mismo criterio que roundPrice). */
function roundedSql(column: SQL, settings: PricingSettings): SQL {
  if (settings.roundingMode === "none") return sql`round(${column}, 2)`;
  const step = sql.raw(`${new D(settings.roundingStep).toFixed(4)}::numeric`);
  return settings.roundingMode === "up" ? sql`(ceil(${column} / ${step}) * ${step})` : sql`(round(${column} / ${step}) * ${step})`;
}

export type RecalcSummary = { evaluated: number; noRate: number; applied: number; pending: number; manualKept: number };

type RecalcOptions = {
  variantIds?: string[];
  /** Publica de inmediato el primer precio de un producto creado o editado por una persona (no hay precio previo que cambiar). */
  publishInitial?: boolean;
  reason: string;
};

const money4 = (d: Dec) => d.toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(4);

/** Recalcula sugeridos (y publica según la política) dentro de una transacción de la empresa. */
export async function recalcTx(tx: Tx, ctx: TenantContext, opts: RecalcOptions): Promise<RecalcSummary> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inventoryos.pricing:${ctx.organizationId}`}))`);
  const settings = await settingsTx(tx, ctx.organizationId);
  const rate = await effectiveRateTx(tx, ctx.organizationId, settings);
  const trm = rate.status === "ok" && rate.trm ? new D(rate.trm) : null;
  const conds: SQL[] = [eq(productVariants.status, "active")];
  if (opts.variantIds) {
    if (opts.variantIds.length === 0) return { evaluated: 0, noRate: 0, applied: 0, pending: 0, manualKept: 0 };
    conds.push(inArray(productVariants.id, opts.variantIds));
  }
  const rows = await tx
    .select({
      id: productVariants.id,
      costAmount: productVariants.costAmount,
      costCurrency: productVariants.costCurrency,
      extraCostCop: productVariants.extraCostCop,
      salePrice: productVariants.salePrice,
      wholesalePrice: productVariants.wholesalePrice,
      retailMode: productVariants.retailPriceMode,
      wholesaleMode: productVariants.wholesalePriceMode,
      productRetail: products.retailMargin,
      productWholesale: products.wholesaleMargin,
      categoryRetail: categories.retailMargin,
      categoryWholesale: categories.wholesaleMargin,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...conds));

  const summary: RecalcSummary = { evaluated: rows.length, noRate: 0, applied: 0, pending: 0, manualKept: 0 };
  const step = new D(settings.roundingStep);
  const updates: Record<string, string | null>[] = [];
  const noRateIds: string[] = [];
  const history: (typeof priceHistory.$inferInsert)[] = [];
  const opt = (v: string | null) => (v === null ? null : new D(v));

  for (const r of rows) {
    const retailMargin = resolveMargin(opt(r.productRetail), opt(r.categoryRetail), new D(settings.retailMargin));
    const wholesaleMargin = resolveMargin(opt(r.productWholesale), opt(r.categoryWholesale), new D(settings.wholesaleMargin));
    const res = computePricing({
      costAmount: new D(r.costAmount),
      costCurrency: r.costCurrency,
      extraCostCop: new D(r.extraCostCop),
      extraCostPercent: new D(settings.extraCostPercent),
      trm,
      fxAdjustmentCop: new D(settings.fxAdjustmentCop),
      retailMargin: retailMargin.value,
      wholesaleMargin: wholesaleMargin.value,
    });
    if (res.status === "no_rate") {
      summary.noRate++;
      noRateIds.push(r.id);
      continue;
    }
    const retailNew = roundPrice(res.retailSuggested, step, settings.roundingMode);
    const wholesaleNew = roundPrice(res.wholesaleSuggested, step, settings.roundingMode);
    const u: Record<string, string | null> = {
      id: r.id,
      suggested_retail: money4(res.retailSuggested),
      suggested_wholesale: money4(res.wholesaleSuggested),
      rate: res.rateApplied ? res.rateApplied.toFixed(6) : null,
      rate_date: res.rateApplied ? rate.validFrom : null,
      rate_source: res.rateApplied ? rate.source : null,
      cost_cop: res.costCop.toFixed(6),
      total_cost: res.totalCost.toFixed(6),
      retail_margin: retailMargin.value.toFixed(4),
      wholesale_margin: wholesaleMargin.value.toFixed(4),
      sale_price: null,
      wholesale_price: null,
    };
    // Minorista
    if (r.retailMode === "manual") summary.manualKept++;
    else if (!new D(r.salePrice).eq(retailNew)) {
      const initial = new D(r.salePrice).isZero() && opts.publishInitial;
      if (settings.applyPolicy === "auto" || initial) {
        u.sale_price = money4(retailNew);
        summary.applied++;
        history.push({ organizationId: ctx.organizationId, variantId: r.id, kind: "retail", oldPrice: r.salePrice, newPrice: money4(retailNew), oldMode: "auto", newMode: "auto", source: "auto", suggestedPrice: money4(res.retailSuggested), rate: u.rate, reason: opts.reason, userId: ctx.userId });
      } else summary.pending++;
    }
    // Mayorista
    if (r.wholesaleMode === "manual") summary.manualKept++;
    else if (r.wholesalePrice === null || !new D(r.wholesalePrice).eq(wholesaleNew)) {
      const initial = r.wholesalePrice === null && opts.publishInitial;
      if (settings.applyPolicy === "auto" || initial) {
        u.wholesale_price = money4(wholesaleNew);
        summary.applied++;
        history.push({ organizationId: ctx.organizationId, variantId: r.id, kind: "wholesale", oldPrice: r.wholesalePrice, newPrice: money4(wholesaleNew), oldMode: "auto", newMode: "auto", source: "auto", suggestedPrice: money4(res.wholesaleSuggested), rate: u.rate, reason: opts.reason, userId: ctx.userId });
      } else summary.pending++;
    }
    updates.push(u);
  }

  // Escrituras por lotes (una sentencia por cada 500 variantes, sin consultas fila a fila).
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = JSON.stringify(updates.slice(i, i + 500));
    await tx.execute(sql`
      update product_variants v set
        suggested_retail_price = d.suggested_retail,
        suggested_wholesale_price = d.suggested_wholesale,
        pricing_status = 'ok',
        pricing_rate = d.rate,
        pricing_rate_date = d.rate_date,
        pricing_rate_source = d.rate_source,
        pricing_cost_cop = d.cost_cop,
        pricing_total_cost = d.total_cost,
        pricing_retail_margin = d.retail_margin,
        pricing_wholesale_margin = d.wholesale_margin,
        pricing_calculated_at = now(),
        cost_price = d.total_cost,
        sale_price = coalesce(d.sale_price, v.sale_price),
        wholesale_price = coalesce(d.wholesale_price, v.wholesale_price),
        updated_at = case when d.sale_price is not null or d.wholesale_price is not null then now() else v.updated_at end
      from jsonb_to_recordset(${chunk}::jsonb) as d(
        id uuid, suggested_retail numeric, suggested_wholesale numeric, rate numeric, rate_date date, rate_source text,
        cost_cop numeric, total_cost numeric, retail_margin numeric, wholesale_margin numeric, sale_price numeric, wholesale_price numeric)
      where v.id = d.id`);
  }
  for (let i = 0; i < noRateIds.length; i += 1000) {
    // Sin tasa: solo se marca; se conservan los últimos sugeridos y precios válidos.
    await tx.update(productVariants).set({ pricingStatus: "no_rate" }).where(inArray(productVariants.id, noRateIds.slice(i, i + 1000)));
  }
  for (let i = 0; i < history.length; i += 500) await tx.insert(priceHistory).values(history.slice(i, i + 500));
  if (!opts.variantIds) await upsertSettings(tx, ctx, { lastRateKey: rate.status === "ok" ? rate.key : settings.lastRateKey });
  return summary;
}

async function upsertSettings(tx: Tx, ctx: TenantContext, patch: Partial<typeof pricingSettings.$inferInsert>) {
  await tx
    .insert(pricingSettings)
    .values({ organizationId: ctx.organizationId, ...patch, updatedBy: ctx.userId })
    .onConflictDoUpdate({ target: pricingSettings.organizationId, set: { ...patch, updatedAt: new Date(), updatedBy: ctx.userId } });
}

/**
 * Si hay una tasa nueva desde el último recálculo, recalcula los precios de la empresa (según su política).
 * Se invoca al abrir el catálogo, los precios o la API: así una TRM nueva del cron se refleja sin intervención.
 * Si otro recálculo de la misma empresa está en curso, no espera.
 */
export async function ensurePricesCurrent(ctx: TenantContext): Promise<RecalcSummary | null> {
  return withTenantTx(ctx, async (tx) => {
    const settings = await settingsTx(tx, ctx.organizationId);
    const rate = await effectiveRateTx(tx, ctx.organizationId, settings);
    if (rate.status !== "ok" || rate.key === settings.lastRateKey) return null;
    const [{ locked }] = (await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${`inventoryos.pricing-ensure:${ctx.organizationId}`})) as locked`)).rows as [{ locked: boolean }];
    if (!locked) return null;
    const summary = await recalcTx(tx, ctx, { reason: `Tasa nueva: ${rate.trm} (${rate.source === "manual" ? "manual" : "TRM oficial"}) + ajuste ${rate.adjustment}` });
    await audit(tx, ctx, "pricing.recalculated", { type: "pricing" }, { trigger: "rate", rateKey: rate.key, ...summary });
    return summary;
  });
}

export async function recalculateAll(ctx: TenantContext) {
  requirePermission(ctx, "pricing.manage");
  return withTenantTx(ctx, async (tx) => {
    const summary = await recalcTx(tx, ctx, { reason: "Recálculo manual" });
    await audit(tx, ctx, "pricing.recalculated", { type: "pricing" }, { trigger: "manual", ...summary });
    return summary;
  });
}

// ---------- Configuración ----------

const margin = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().replace(",", ".") : v),
    z.union([z.string(), z.number()]).transform((v, c) => {
      const s = String(v);
      if (!/^\d+(\.\d{1,4})?$/.test(s)) {
        c.addIssue({ code: "custom", message: `${label}: escribe un número, por ejemplo 30 o 27,5.` });
        return z.NEVER;
      }
      const d = new D(s);
      if (d.gte(100)) {
        c.addIssue({ code: "custom", message: `${label}: debe ser menor que 100 (es un margen sobre el precio de venta).` });
        return z.NEVER;
      }
      return d;
    }),
  );
const optionalMargin = (label: string) => z.preprocess((v) => (v === "" || v === undefined ? null : v), margin(label).nullable());

const settingsSchema = z.object({
  fxAdjustmentCop: zMoney("El ajuste cambiario"),
  retailMargin: margin("Margen minorista"),
  wholesaleMargin: margin("Margen mayorista"),
  extraCostPercent: z.preprocess((v) => (typeof v === "string" ? v.trim().replace(",", ".") : v), z.coerce.number().min(0).max(1000)).transform((v) => new D(String(v))),
  roundingStep: zMoney("El paso de redondeo").refine((d) => d.gt(0), "El paso de redondeo debe ser mayor que cero."),
  roundingMode: z.enum(["up", "nearest", "none"]),
  applyPolicy: z.enum(["auto", "approval"]),
  rateMode: z.enum(["auto", "manual"]),
  maxRateAgeHours: z.coerce.number().int().min(1, "Mínimo 1 hora.").max(720, "Máximo 720 horas."),
});

export async function getPricingOverview(ctx: TenantContext) {
  requirePermission(ctx, "catalog.read");
  return withTenantTx(ctx, async (tx) => {
    const settings = await settingsTx(tx, ctx.organizationId);
    const rate = await effectiveRateTx(tx, ctx.organizationId, settings);
    const active = eq(productVariants.status, "active");
    const [manual] = await tx
      .select({ n: count() })
      .from(productVariants)
      .where(and(active, sql`(${productVariants.retailPriceMode} = 'manual' or ${productVariants.wholesalePriceMode} = 'manual')`));
    const [noRate] = await tx.select({ n: count() }).from(productVariants).where(and(active, eq(productVariants.pricingStatus, "no_rate")));
    const [usd] = await tx.select({ n: count() }).from(productVariants).where(and(active, eq(productVariants.costCurrency, "USD")));
    const [below] = await tx
      .select({ n: count() })
      .from(productVariants)
      .where(and(active, sql`${productVariants.pricingTotalCost} is not null and (${productVariants.salePrice} < ${productVariants.pricingTotalCost} or ${productVariants.wholesalePrice} < ${productVariants.pricingTotalCost})`));
    const [pending] = await tx.select({ n: count() }).from(productVariants).where(and(active, pendingCondition(settings)));
    return { settings, rate, counts: { manual: manual?.n ?? 0, noRate: noRate?.n ?? 0, usd: usd?.n ?? 0, belowCost: below?.n ?? 0, pending: pending?.n ?? 0 } };
  });
}

export async function updatePricingSettings(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "pricing.manage");
  const input = parseOrThrow(settingsSchema, raw);
  return withTenantTx(ctx, async (tx) => {
    const before = await settingsTx(tx, ctx.organizationId);
    const values = {
      fxAdjustmentCop: input.fxAdjustmentCop.toFixed(4),
      retailMargin: input.retailMargin.toFixed(4),
      wholesaleMargin: input.wholesaleMargin.toFixed(4),
      extraCostPercent: input.extraCostPercent.toFixed(4),
      roundingStep: input.roundingStep.toFixed(4),
      roundingMode: input.roundingMode,
      applyPolicy: input.applyPolicy,
      rateMode: input.rateMode,
      maxRateAgeHours: input.maxRateAgeHours,
    };
    await upsertSettings(tx, ctx, values);
    await audit(tx, ctx, "pricing.settings_updated", { type: "pricing" }, { before: { ...before, updatedAt: undefined }, after: values });
    return recalcTx(tx, ctx, { reason: "Cambio en la configuración de precios" });
  });
}

const manualRateSchema = z.object({
  rate: zMoney("La TRM").refine((d) => d.gte(1000) && d.lte(20000), "La TRM debe estar entre 1.000 y 20.000 COP por USD."),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.").optional(),
  reason: z.string().trim().min(3, "Indica el motivo (mínimo 3 caracteres).").max(300),
});

/** Registra una TRM manual (trazable: quién, cuándo, por qué). Pasa la empresa a modo manual. */
export async function setManualRate(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "pricing.manage");
  const input = parseOrThrow(manualRateSchema, raw);
  const validFrom = input.validFrom ?? todayBogota();
  if (validFrom > todayBogota()) throw new ValidationError("La fecha de vigencia no puede ser futura.", { validFrom: ["No puede ser futura."] });
  return withTenantTx(ctx, async (tx) => {
    const [row] = await tx
      .insert(manualExchangeRates)
      .values({ organizationId: ctx.organizationId, rate: input.rate.toFixed(6), validFrom, reason: input.reason, createdBy: ctx.userId })
      .returning({ id: manualExchangeRates.id });
    await upsertSettings(tx, ctx, { rateMode: "manual" });
    await audit(tx, ctx, "pricing.manual_rate", { type: "manual_exchange_rate", id: row!.id }, { rate: input.rate.toString(), validFrom, reason: input.reason });
    return recalcTx(tx, ctx, { reason: `TRM manual ${input.rate.toString()}: ${input.reason}` });
  });
}

export async function listManualRates(ctx: TenantContext, limit = 20) {
  requirePermission(ctx, "catalog.read");
  return withTenantTx(ctx, (tx) =>
    tx
      .select({ id: manualExchangeRates.id, rate: manualExchangeRates.rate, validFrom: manualExchangeRates.validFrom, reason: manualExchangeRates.reason, createdAt: manualExchangeRates.createdAt, userName: users.name })
      .from(manualExchangeRates)
      .innerJoin(users, eq(users.id, manualExchangeRates.createdBy))
      .orderBy(desc(manualExchangeRates.createdAt))
      .limit(Math.min(limit, 100)),
  );
}

/** Consulta la TRM al proveedor (manual, con límite de frecuencia) y recalcula si cambió. */
export async function refreshRateNow(ctx: TenantContext): Promise<{ refresh: RefreshResult; recalc: RecalcSummary | null }> {
  requirePermission(ctx, "pricing.manage");
  const refresh = await refreshExchangeRate({ trigger: "manual", userId: ctx.userId });
  const recalc = await ensurePricesCurrent(ctx);
  return { refresh, recalc };
}

const categoryMarginsSchema = z.object({ retailMargin: optionalMargin("Margen minorista"), wholesaleMargin: optionalMargin("Margen mayorista") });

export async function setCategoryMargins(ctx: TenantContext, categoryId: string, raw: unknown) {
  requirePermission(ctx, "pricing.manage");
  const input = parseOrThrow(categoryMarginsSchema, raw);
  return withTenantTx(ctx, async (tx) => {
    const updated = await tx
      .update(categories)
      .set({ retailMargin: input.retailMargin?.toFixed(4) ?? null, wholesaleMargin: input.wholesaleMargin?.toFixed(4) ?? null })
      .where(eq(categories.id, categoryId))
      .returning({ id: categories.id });
    if (!updated.length) throw new NotFoundError("Categoría no encontrada.");
    await audit(tx, ctx, "pricing.category_margins", { type: "category", id: categoryId }, { retailMargin: input.retailMargin?.toString() ?? null, wholesaleMargin: input.wholesaleMargin?.toString() ?? null });
    const ids = (
      await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(eq(products.categoryId, categoryId))
    ).map((r) => r.id);
    return recalcTx(tx, ctx, { variantIds: ids, reason: "Cambio de márgenes de la categoría" });
  });
}

export async function listCategoryMargins(ctx: TenantContext) {
  requirePermission(ctx, "catalog.read");
  return withTenantTx(ctx, (tx) =>
    tx.select({ id: categories.id, name: categories.name, retailMargin: categories.retailMargin, wholesaleMargin: categories.wholesaleMargin }).from(categories).orderBy(categories.name),
  );
}

// ---------- Cambios pendientes (vista previa) y aprobación ----------

function pendingCondition(settings: PricingSettings): SQL {
  const r = roundedSql(sql`${productVariants.suggestedRetailPrice}`, settings);
  const w = roundedSql(sql`${productVariants.suggestedWholesalePrice}`, settings);
  return sql`${productVariants.pricingStatus} = 'ok' and (
    (${productVariants.retailPriceMode} = 'auto' and ${productVariants.suggestedRetailPrice} is not null and ${productVariants.salePrice} <> ${r})
    or (${productVariants.wholesalePriceMode} = 'auto' and ${productVariants.suggestedWholesalePrice} is not null and ${productVariants.wholesalePrice} is distinct from ${w}))`;
}

export async function listPendingChanges(ctx: TenantContext, f: { page?: number; pageSize?: number } = {}) {
  requirePermission(ctx, "catalog.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, f.pageSize ?? 50);
  return withTenantTx(ctx, async (tx) => {
    const settings = await settingsTx(tx, ctx.organizationId);
    const where = and(eq(productVariants.status, "active"), pendingCondition(settings));
    const rows = await tx
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        variantName: productVariants.name,
        sku: productVariants.sku,
        costCurrency: productVariants.costCurrency,
        totalCost: productVariants.pricingTotalCost,
        rate: productVariants.pricingRate,
        retailMode: productVariants.retailPriceMode,
        wholesaleMode: productVariants.wholesalePriceMode,
        retailCurrent: productVariants.salePrice,
        retailNew: sql<string>`${roundedSql(sql`${productVariants.suggestedRetailPrice}`, settings)}`,
        wholesaleCurrent: productVariants.wholesalePrice,
        wholesaleNew: sql<string>`${roundedSql(sql`${productVariants.suggestedWholesalePrice}`, settings)}`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where)
      .orderBy(products.name, productVariants.sku)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx.select({ n: count() }).from(productVariants).where(where);
    return {
      rows: rows.map((r) => ({
        ...r,
        retailChanges: r.retailMode === "auto" && !new D(r.retailCurrent).eq(r.retailNew),
        wholesaleChanges: r.wholesaleMode === "auto" && (r.wholesaleCurrent === null || !new D(r.wholesaleCurrent).eq(r.wholesaleNew)),
        wholesaleBelowCost: isBelowCost(new D(r.wholesaleNew), r.totalCost ? new D(r.totalCost) : null),
      })),
      total: total?.n ?? 0,
      page,
      pageSize,
      policy: settings.applyPolicy,
    };
  });
}

const approveSchema = z.object({
  variantIds: z.union([z.literal("all"), z.array(zUuid("Variante")).min(1).max(1000)]),
  reason: z.string().trim().max(300).optional(),
});

/** Publica los precios automáticos pendientes (todos o los seleccionados). */
export async function approvePriceChanges(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "pricing.manage");
  const input = parseOrThrow(approveSchema, raw);
  return withTenantTx(ctx, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inventoryos.pricing:${ctx.organizationId}`}))`);
    const settings = await settingsTx(tx, ctx.organizationId);
    const conds: SQL[] = [eq(productVariants.status, "active"), pendingCondition(settings)];
    if (input.variantIds !== "all") conds.push(inArray(productVariants.id, input.variantIds));
    const rows = await tx
      .select({
        id: productVariants.id,
        retailMode: productVariants.retailPriceMode,
        wholesaleMode: productVariants.wholesalePriceMode,
        retailCurrent: productVariants.salePrice,
        wholesaleCurrent: productVariants.wholesalePrice,
        retailSuggested: productVariants.suggestedRetailPrice,
        wholesaleSuggested: productVariants.suggestedWholesalePrice,
        rate: productVariants.pricingRate,
      })
      .from(productVariants)
      .where(and(...conds))
      .for("update");
    const step = new D(settings.roundingStep);
    const history: (typeof priceHistory.$inferInsert)[] = [];
    let applied = 0;
    for (const r of rows) {
      const patch: Partial<typeof productVariants.$inferInsert> = {};
      if (r.retailMode === "auto" && r.retailSuggested) {
        const next = roundPrice(new D(r.retailSuggested), step, settings.roundingMode);
        if (!next.eq(r.retailCurrent)) {
          patch.salePrice = money4(next);
          history.push({ organizationId: ctx.organizationId, variantId: r.id, kind: "retail", oldPrice: r.retailCurrent, newPrice: money4(next), oldMode: "auto", newMode: "auto", source: "approval", suggestedPrice: r.retailSuggested, rate: r.rate, reason: input.reason || "Aprobado en la vista previa", userId: ctx.userId });
        }
      }
      if (r.wholesaleMode === "auto" && r.wholesaleSuggested) {
        const next = roundPrice(new D(r.wholesaleSuggested), step, settings.roundingMode);
        if (r.wholesaleCurrent === null || !next.eq(r.wholesaleCurrent)) {
          patch.wholesalePrice = money4(next);
          history.push({ organizationId: ctx.organizationId, variantId: r.id, kind: "wholesale", oldPrice: r.wholesaleCurrent, newPrice: money4(next), oldMode: "auto", newMode: "auto", source: "approval", suggestedPrice: r.wholesaleSuggested, rate: r.rate, reason: input.reason || "Aprobado en la vista previa", userId: ctx.userId });
        }
      }
      if (Object.keys(patch).length) {
        await tx.update(productVariants).set({ ...patch, updatedAt: new Date() }).where(eq(productVariants.id, r.id));
        applied++;
      }
    }
    for (let i = 0; i < history.length; i += 500) await tx.insert(priceHistory).values(history.slice(i, i + 500));
    await audit(tx, ctx, "pricing.changes_approved", { type: "pricing" }, { variants: applied, prices: history.length });
    return { variants: applied, prices: history.length };
  });
}

// ---------- Precios manuales ----------

const manualPriceSchema = z.object({
  variantId: zUuid("Variante"),
  kind: z.enum(["retail", "wholesale"]),
  price: zMoney("El precio"),
  reason: z.string().trim().min(3, "Indica el motivo (mínimo 3 caracteres).").max(300),
  acceptBelowCost: z.boolean().default(false),
});

/** Fija un precio manual: ningún recálculo lo cambiará hasta volver a modo automático. */
export async function setManualPrice(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "pricing.manage");
  const input = parseOrThrow(manualPriceSchema, raw);
  return withTenantTx(ctx, async (tx) => {
    const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, input.variantId)).for("update");
    if (!v) throw new NotFoundError("Producto no encontrado.");
    await applyManualPriceTx(tx, ctx, v, input.kind, input.price, input.reason, input.acceptBelowCost);
  });
}

type VariantRow = typeof productVariants.$inferSelect;

export class BelowCostError extends ValidationError {}

/** Aplica un precio manual a una variante ya bloqueada (FOR UPDATE). Se usa también desde el formulario e importación. */
export async function applyManualPriceTx(tx: Tx, ctx: TenantContext, v: VariantRow, kind: "retail" | "wholesale", price: Dec, reason: string, acceptBelowCost: boolean, source: "manual" | "import" = "manual") {
  const cost = v.pricingTotalCost ? new D(v.pricingTotalCost) : new D(v.costPrice);
  if (cost.gt(0) && price.lt(cost) && !acceptBelowCost) {
    const label = kind === "retail" ? "minorista" : "mayorista";
    const msg = `El precio ${label} de ${v.sku} (${price.toString()}) es menor que su costo total (${cost.toDecimalPlaces(2).toString()}). Confirma que quieres venderlo por debajo del costo.`;
    throw new BelowCostError(msg, { acceptBelowCost: [msg] });
  }
  const oldPrice = kind === "retail" ? v.salePrice : v.wholesalePrice;
  const oldMode = kind === "retail" ? v.retailPriceMode : v.wholesalePriceMode;
  const newPrice = money4(price);
  if (oldMode === "manual" && oldPrice !== null && new D(oldPrice).eq(price)) return false;
  await tx
    .update(productVariants)
    .set(kind === "retail" ? { salePrice: newPrice, retailPriceMode: "manual", updatedAt: new Date() } : { wholesalePrice: newPrice, wholesalePriceMode: "manual", updatedAt: new Date() })
    .where(eq(productVariants.id, v.id));
  await tx.insert(priceHistory).values({
    organizationId: ctx.organizationId,
    variantId: v.id,
    kind,
    oldPrice,
    newPrice,
    oldMode,
    newMode: "manual",
    source,
    suggestedPrice: kind === "retail" ? v.suggestedRetailPrice : v.suggestedWholesalePrice,
    rate: v.pricingRate,
    reason,
    userId: ctx.userId,
  });
  return true;
}

const revertSchema = z.object({ variantId: zUuid("Variante"), kind: z.enum(["retail", "wholesale"]), reason: z.string().trim().min(3, "Indica el motivo (mínimo 3 caracteres).").max(300) });

/** Devuelve un precio al modo automático. Según la política, el sugerido se publica ya o queda pendiente. */
export async function revertToAuto(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "pricing.manage");
  const input = parseOrThrow(revertSchema, raw);
  return withTenantTx(ctx, async (tx) => {
    const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, input.variantId)).for("update");
    if (!v) throw new NotFoundError("Producto no encontrado.");
    await revertToAutoTx(tx, ctx, v, input.kind, input.reason);
  });
}

export async function revertToAutoTx(tx: Tx, ctx: TenantContext, v: VariantRow, kind: "retail" | "wholesale", reason: string) {
  const mode = kind === "retail" ? v.retailPriceMode : v.wholesalePriceMode;
  if (mode === "auto") throw new ConflictError("Ese precio ya está en modo automático.");
  const oldPrice = kind === "retail" ? v.salePrice : v.wholesalePrice;
  await tx.update(productVariants).set(kind === "retail" ? { retailPriceMode: "auto" } : { wholesalePriceMode: "auto" }).where(eq(productVariants.id, v.id));
  await tx.insert(priceHistory).values({ organizationId: ctx.organizationId, variantId: v.id, kind, oldPrice, newPrice: oldPrice, oldMode: "manual", newMode: "auto", source: "revert", suggestedPrice: kind === "retail" ? v.suggestedRetailPrice : v.suggestedWholesalePrice, rate: v.pricingRate, reason, userId: ctx.userId });
  // El recálculo publica el sugerido si la política es automática; si no, queda pendiente de aprobación.
  await recalcTx(tx, ctx, { variantIds: [v.id], reason: `Vuelve a automático: ${reason}` });
}

// ---------- Historial ----------

export async function listPriceHistory(ctx: TenantContext, f: { variantId?: string; productId?: string; page?: number; pageSize?: number } = {}) {
  requirePermission(ctx, "catalog.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, f.pageSize ?? 50);
  return withTenantTx(ctx, async (tx) => {
    const conds: SQL[] = [];
    if (f.variantId) conds.push(eq(priceHistory.variantId, f.variantId));
    if (f.productId) conds.push(eq(productVariants.productId, f.productId));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await tx
      .select({
        id: priceHistory.id,
        kind: priceHistory.kind,
        oldPrice: priceHistory.oldPrice,
        newPrice: priceHistory.newPrice,
        oldMode: priceHistory.oldMode,
        newMode: priceHistory.newMode,
        source: priceHistory.source,
        suggestedPrice: priceHistory.suggestedPrice,
        rate: priceHistory.rate,
        reason: priceHistory.reason,
        createdAt: priceHistory.createdAt,
        userName: users.name,
        sku: productVariants.sku,
        productId: productVariants.productId,
        productName: products.name,
      })
      .from(priceHistory)
      .innerJoin(productVariants, eq(productVariants.id, priceHistory.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(users, eq(users.id, priceHistory.userId))
      .where(where)
      .orderBy(desc(priceHistory.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx.select({ n: count() }).from(priceHistory).innerJoin(productVariants, eq(productVariants.id, priceHistory.variantId)).where(where);
    return { rows, total: total?.n ?? 0, page, pageSize };
  });
}

export const canManagePricing = (ctx: TenantContext) => can(ctx, "pricing.manage");

/** Datos para la estimación visual del precio automático en el formulario de producto. */
export async function getPricingHints(ctx: TenantContext) {
  requirePermission(ctx, "catalog.read");
  return withTenantTx(ctx, async (tx) => {
    const s = await settingsTx(tx, ctx.organizationId);
    const rate = await effectiveRateTx(tx, ctx.organizationId, s);
    return {
      retailMargin: new D(s.retailMargin).toString(),
      wholesaleMargin: new D(s.wholesaleMargin).toString(),
      appliedRate: rate.status === "ok" ? rate.applied : null,
      extraCostPercent: new D(s.extraCostPercent).toString(),
      roundingStep: new D(s.roundingStep).toString(),
      roundingMode: s.roundingMode,
    };
  });
}
