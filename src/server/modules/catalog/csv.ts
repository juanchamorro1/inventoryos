import { and, eq, inArray, sql } from "drizzle-orm";
import Papa from "papaparse";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { brands, categories, productVariants, products, suppliers, taxRates } from "../../db/schema";
import { withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { costStr, D, type Dec, moneyStr, qtyStr } from "../../platform/decimal";
import { ForbiddenError } from "../../platform/errors";
import { can, requirePermission } from "../../platform/permissions";
import { assertWithinPlan } from "../../platform/plans";
import { zDecimal, zMoney, zUnitCost } from "../../platform/validation";
import { applyManualPriceTx, BelowCostError, recalcTx, revertToAutoTx, settingsTx } from "../pricing/service";

export const CSV_COLUMNS = [
  "producto",
  "sku",
  "variante",
  "opciones",
  "categoria",
  "marca",
  "codigo_barras",
  "codigo_referencia",
  "proveedor",
  "moneda_costo",
  "costo",
  "costo_adicional",
  "precio",
  "precio_mayorista",
  "minimo_mayorista",
  "margen_minorista",
  "margen_mayorista",
  "impuesto",
  "stock_minimo",
  "unidad",
  "descripcion",
  "existencias",
] as const;

/** Máximo de filas por archivo con importProductsCsv (una sola transacción; para archivos pequeños y scripts). */
const MAX_ROWS = 5000;
/** Máximo de filas por lote en la importación por partes desde la interfaz. */
export const IMPORT_CHUNK_MAX = 200;

const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
const optionalDec = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (blank(v) ? null : v), schema.nullable());
/** "auto" en una columna de precio = volver a automático. */
const priceCell = (label: string) => z.preprocess((v) => (blank(v) ? null : String(v).trim().toLowerCase() === "auto" ? "auto" : v), z.union([z.literal("auto"), zMoney(label)]).nullable());
const marginCell = (label: string) =>
  optionalDec(zDecimal({ scale: 4, min: 0, label }).refine((d) => d.lt(100), `${label}: debe ser menor que 100 (margen sobre el precio de venta).`));

const rowSchema = z.object({
  producto: z.string().trim().min(2, "producto: obligatorio").max(160),
  sku: z
    .string()
    .trim()
    .min(1, "sku: obligatorio")
    .max(64)
    .regex(/^[A-Za-z0-9._\-/]+$/, "sku: caracteres inválidos"),
  variante: z.string().trim().max(120).default(""),
  opciones: z.string().trim().max(500).default(""),
  categoria: z.string().trim().max(80).default(""),
  marca: z.string().trim().max(80).default(""),
  codigo_barras: z
    .string()
    .trim()
    .max(64)
    .regex(/^[0-9A-Za-z\-]*$/, "codigo_barras: inválido")
    .default(""),
  codigo_referencia: z.string().trim().max(64, "codigo_referencia: máximo 64 caracteres").default(""),
  proveedor: z.string().trim().max(160).default(""),
  moneda_costo: z.preprocess((v) => (blank(v) ? "COP" : String(v).trim().toUpperCase()), z.enum(["COP", "USD"], { message: "moneda_costo: usa COP o USD" })),
  costo: optionalDec(zUnitCost("costo")),
  costo_adicional: optionalDec(zMoney("costo_adicional")),
  precio: priceCell("precio"),
  precio_mayorista: priceCell("precio_mayorista"),
  minimo_mayorista: optionalDec(zDecimal({ scale: 4, positive: true, label: "minimo_mayorista" })),
  margen_minorista: marginCell("margen_minorista"),
  margen_mayorista: marginCell("margen_mayorista"),
  impuesto: z.string().trim().default(""),
  stock_minimo: optionalDec(zDecimal({ scale: 4, min: 0, label: "stock_minimo" })),
  unidad: z.string().trim().max(20).default(""),
  descripcion: z.string().trim().max(4000).default(""),
});

export type ImportRowError = { row: number; message: string };
export type ImportResult = { created: number; updated: number; productsCreated: number; errors: ImportRowError[]; applied: boolean };
type Row = z.output<typeof rowSchema> & { line: number; optionValues: Record<string, string> };

function parseOptions(text: string): Record<string, string> | null {
  if (!text) return {};
  const out: Record<string, string> = {};
  for (const part of text.split(";")) {
    if (!part.trim()) continue;
    const [k, ...rest] = part.split("=");
    const key = k?.trim();
    const value = rest.join("=").trim();
    if (!key || !value) return null;
    out[key] = value;
  }
  return out;
}

async function lookupId(tx: Tx, ctx: TenantContext, table: typeof categories | typeof brands, name: string, cache: Map<string, string>) {
  if (!name) return null;
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const [found] = await tx.select({ id: table.id }).from(table).where(sql`lower(${table.name}) = ${key}`);
  const id = found?.id ?? (await tx.insert(table).values({ organizationId: ctx.organizationId, name }).returning({ id: table.id }))[0]!.id;
  cache.set(key, id);
  return id;
}

/** Valida el formato de las filas (sin consultar la base). Detecta SKU y códigos de barras repetidos en el lote. */
function validateRows(raw: Record<string, unknown>[], firstLine: number, errors: ImportRowError[]): Row[] {
  const rows: Row[] = [];
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  raw.forEach((data, i) => {
    const line = firstLine + i;
    const r = rowSchema.safeParse(data);
    if (!r.success) {
      errors.push({ row: line, message: r.error.issues.map((x) => x.message).join("; ") });
      return;
    }
    const optionValues = parseOptions(r.data.opciones);
    if (!optionValues) {
      errors.push({ row: line, message: 'opciones: usa el formato "Color=Negro;Memoria=128GB".' });
      return;
    }
    const skuKey = r.data.sku.toLowerCase();
    if (seenSku.has(skuKey)) errors.push({ row: line, message: `sku repetido (ya aparece en la fila ${seenSku.get(skuKey)}).` });
    seenSku.set(skuKey, line);
    if (r.data.codigo_barras) {
      if (seenBarcode.has(r.data.codigo_barras)) errors.push({ row: line, message: `codigo_barras repetido (fila ${seenBarcode.get(r.data.codigo_barras)}).` });
      seenBarcode.set(r.data.codigo_barras, line);
    }
    rows.push({ ...r.data, line, optionValues });
  });
  return rows;
}

/**
 * Aplica filas ya validadas dentro de una transacción. Cada fila es una variante; las filas con el mismo
 * "producto" se agrupan. Si el SKU existe se actualiza; las celdas vacías de un SKU existente no cambian su valor
 * (costo, precios, mínimo…). En precios: un número fija un precio MANUAL; "auto" lo devuelve a automático.
 */
async function applyRows(tx: Tx, ctx: TenantContext, rows: Row[], errors: ImportRowError[], acceptBelowCost: boolean) {
  const taxes = await tx.select().from(taxRates);
  const resolveTax = (value: string) => {
    if (!value) return { id: taxes.find((t) => t.isDefault)?.id ?? null };
    const name = value.trim().toLowerCase();
    const rate = name.replace("%", "").trim();
    const t = taxes.find((x) => x.name.toLowerCase() === name) ?? (/^\d+(\.\d+)?$/.test(rate) ? taxes.find((x) => new D(x.rate).eq(rate)) : undefined);
    return t ? { id: t.id } : null;
  };
  const supplierCache = new Map<string, string | null>();
  const resolveSupplier = async (name: string) => {
    const key = name.toLowerCase();
    if (!supplierCache.has(key)) {
      const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = ${key}`).limit(1);
      supplierCache.set(key, s?.id ?? null);
    }
    return supplierCache.get(key)!;
  };
  const catCache = new Map<string, string>();
  const brandCache = new Map<string, string>();
  const productCache = new Map<string, string>();
  const { retailAutoEnabled } = await settingsTx(tx, ctx.organizationId);
  let created = 0;
  let updated = 0;
  let productsCreated = 0;
  const intents: { line: number; id: string; retail: Dec | "auto" | null; wholesale: Dec | "auto" | null }[] = [];

  for (const row of rows) {
    const tax = resolveTax(row.impuesto);
    if (!tax) {
      errors.push({ row: row.line, message: `impuesto "${row.impuesto}" no existe. Créalo en Configuración › Impuestos.` });
      continue;
    }
    const supplierId = row.proveedor ? await resolveSupplier(row.proveedor) : null;
    if (row.proveedor && !supplierId) {
      errors.push({ row: row.line, message: `proveedor "${row.proveedor}" no existe. Créalo en Compras › Proveedores.` });
      continue;
    }
    if (row.codigo_barras) {
      const [dup] = await tx
        .select({ sku: productVariants.sku })
        .from(productVariants)
        .where(and(eq(productVariants.barcode, row.codigo_barras), sql`lower(${productVariants.sku}) <> ${row.sku.toLowerCase()}`));
      if (dup) {
        errors.push({ row: row.line, message: `codigo_barras ya usado por el SKU ${dup.sku}.` });
        continue;
      }
    }
    const categoryId = await lookupId(tx, ctx, categories, row.categoria, catCache);
    const brandId = await lookupId(tx, ctx, brands, row.marca, brandCache);
    const productFields = {
      ...(categoryId ? { categoryId } : {}),
      ...(brandId ? { brandId } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(row.impuesto ? { taxRateId: tax.id } : {}),
      ...(row.unidad ? { unit: row.unidad } : {}),
      ...(row.descripcion ? { description: row.descripcion } : {}),
      ...(row.margen_minorista ? { retailMargin: row.margen_minorista.toFixed(4) } : {}),
      ...(row.margen_mayorista ? { wholesaleMargin: row.margen_mayorista.toFixed(4) } : {}),
      updatedAt: new Date(),
    };
    const [existing] = await tx
      .select({ id: productVariants.id, productId: productVariants.productId })
      .from(productVariants)
      .where(sql`lower(${productVariants.sku}) = ${row.sku.toLowerCase()}`)
      .for("update");
    if (!retailAutoEnabled && (row.precio === "auto" || (!existing && row.precio === null))) {
      errors.push({ row: row.line, message: "precio: obligatorio, los precios automáticos están apagados en Configuración › Sistemas de precios." });
      continue;
    }
    // Solo se escriben las celdas con valor (en un SKU existente, vacío = sin cambios).
    const costFields = {
      ...(row.costo !== null ? { costAmount: costStr(row.costo), costCurrency: row.moneda_costo, ...(row.moneda_costo === "COP" ? { costPrice: costStr(row.costo) } : {}) } : {}),
      ...(row.costo_adicional !== null ? { extraCostCop: moneyStr(row.costo_adicional) } : {}),
      ...(row.minimo_mayorista !== null ? { wholesaleMinQty: qtyStr(row.minimo_mayorista) } : {}),
      ...(row.stock_minimo !== null ? { lowStockThreshold: qtyStr(row.stock_minimo) } : {}),
      ...(row.codigo_referencia ? { referenceCode: row.codigo_referencia } : {}),
      ...(row.codigo_barras ? { barcode: row.codigo_barras } : {}),
      ...(row.variante || Object.keys(row.optionValues).length ? { name: row.variante || Object.values(row.optionValues).join(" / "), optionValues: row.optionValues } : {}),
    };
    // Un precio manual se marca antes del recálculo para que este no publique un automático.
    const modes = {
      ...(row.precio && row.precio !== "auto" ? { retailPriceMode: "manual" as const } : {}),
      ...(row.precio_mayorista && row.precio_mayorista !== "auto" ? { wholesalePriceMode: "manual" as const } : {}),
    };
    let id: string;
    if (existing) {
      await tx.update(productVariants).set({ ...costFields, ...modes, status: "active", updatedAt: new Date() }).where(eq(productVariants.id, existing.id));
      await tx.update(products).set({ ...productFields, name: row.producto, status: "active" }).where(eq(products.id, existing.productId));
      id = existing.id;
      updated++;
    } else {
      const pKey = row.producto.toLowerCase();
      let productId = productCache.get(pKey);
      if (!productId) {
        const [found] = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(sql`lower(${products.name}) = ${pKey}`, eq(products.status, "active")))
          .limit(1);
        if (found) productId = found.id;
        else {
          const [p] = await tx
            .insert(products)
            .values({ organizationId: ctx.organizationId, name: row.producto, createdBy: ctx.userId, unit: "unidad", taxRateId: tax.id, ...productFields })
            .returning({ id: products.id });
          productId = p!.id;
          productsCreated++;
        }
        productCache.set(pKey, productId);
      }
      const [v] = await tx
        .insert(productVariants)
        .values({ organizationId: ctx.organizationId, productId, sku: row.sku, costCurrency: row.moneda_costo, ...costFields, ...modes })
        .returning({ id: productVariants.id });
      id = v!.id;
      created++;
    }
    intents.push({ line: row.line, id, retail: row.precio, wholesale: row.precio_mayorista });
  }
  if (errors.length) return { created, updated, productsCreated };

  await recalcTx(tx, ctx, { variantIds: intents.map((i) => i.id), publishInitial: true, reason: "Importación de productos" });
  const current = new Map((await tx.select().from(productVariants).where(inArray(productVariants.id, intents.map((i) => i.id)))).map((v) => [v.id, v]));
  for (const it of intents) {
    for (const kind of ["retail", "wholesale"] as const) {
      const wanted = kind === "retail" ? it.retail : it.wholesale;
      if (wanted === null) continue;
      const v = current.get(it.id)!;
      try {
        if (wanted === "auto") {
          if ((kind === "retail" ? v.retailPriceMode : v.wholesalePriceMode) === "manual") await revertToAutoTx(tx, ctx, v, kind, "Importación: volver a automático");
        } else {
          await applyManualPriceTx(tx, ctx, v, kind, wanted, "Importación de productos", acceptBelowCost, "import");
        }
      } catch (err) {
        if (err instanceof BelowCostError) {
          errors.push({ row: it.line, message: err.message });
          continue;
        }
        throw err;
      }
      const [fresh] = await tx.select().from(productVariants).where(eq(productVariants.id, it.id));
      current.set(it.id, fresh!);
    }
  }
  return { created, updated, productsCreated };
}

function assertImportPermissions(ctx: TenantContext, rows: Row[]) {
  requirePermission(ctx, "catalog.write");
  const prices = rows.some((r) => r.precio !== null || r.precio_mayorista !== null || r.margen_minorista || r.margen_mayorista);
  if (prices && !can(ctx, "pricing.manage")) throw new ForbiddenError("No tienes permiso para importar precios o márgenes manuales.");
}

class Abort extends Error {}

async function run(ctx: TenantContext, rows: Row[], errors: ImportRowError[], opts: { dryRun?: boolean; acceptBelowCost?: boolean }): Promise<ImportResult> {
  if (errors.length) return { created: 0, updated: 0, productsCreated: 0, errors, applied: false };
  try {
    return await withTenantTx(ctx, async (tx) => {
      const counts = await applyRows(tx, ctx, rows, errors, opts.acceptBelowCost ?? false);
      if (errors.length) throw new Abort();
      await assertWithinPlan(tx, ctx.organizationId, "variants", 0);
      if (opts.dryRun) throw new Abort();
      await audit(tx, ctx, "product.imported", { type: "product" }, counts);
      return { ...counts, errors, applied: true };
    });
  } catch (err) {
    if (err instanceof Abort) return { created: 0, updated: 0, productsCreated: 0, errors, applied: false };
    throw err;
  }
}

/**
 * Importa un lote de filas ya leídas en el navegador (máximo IMPORT_CHUNK_MAX). Cada lote es atómico: si una
 * fila falla no se aplica nada de ese lote. Reaplicar un lote es seguro (los SKU existentes se actualizan).
 * `firstLine` es el número de línea del archivo de la primera fila (para reportar errores).
 */
export async function importProductRows(ctx: TenantContext, raw: unknown, opts: { dryRun?: boolean; firstLine?: number; acceptBelowCost?: boolean } = {}): Promise<ImportResult> {
  requirePermission(ctx, "catalog.write");
  const errors: ImportRowError[] = [];
  if (!Array.isArray(raw) || raw.length === 0) return { created: 0, updated: 0, productsCreated: 0, errors: [{ row: 1, message: "El lote está vacío." }], applied: false };
  if (raw.length > IMPORT_CHUNK_MAX) return { created: 0, updated: 0, productsCreated: 0, errors: [{ row: 1, message: `Máximo ${IMPORT_CHUNK_MAX} filas por lote.` }], applied: false };
  const normalized = raw.map((r) => (r && typeof r === "object" ? Object.fromEntries(Object.entries(r as Record<string, unknown>).map(([k, v]) => [k.trim().toLowerCase(), typeof v === "string" ? v : v == null ? "" : String(v)])) : {}));
  const rows = validateRows(normalized, opts.firstLine ?? 2, errors);
  if (!errors.length) assertImportPermissions(ctx, rows);
  return run(ctx, rows, errors, opts);
}

/**
 * Importa productos desde un texto CSV completo en UNA transacción (todo o nada). Pensado para archivos
 * pequeños, scripts y pruebas; la interfaz usa importProductRows por lotes.
 */
export async function importProductsCsv(ctx: TenantContext, text: string, opts: { dryRun?: boolean; acceptBelowCost?: boolean } = {}): Promise<ImportResult> {
  requirePermission(ctx, "catalog.write");
  const clean = text.replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
    delimitersToGuess: [",", ";", "\t"],
  });
  const errors: ImportRowError[] = parsed.errors.slice(0, 50).map((e) => ({ row: (e.row ?? 0) + 2, message: `Formato CSV: ${e.message}` }));
  const headers = parsed.meta.fields ?? [];
  for (const required of ["producto", "sku"]) {
    if (!headers.includes(required)) errors.push({ row: 1, message: `Falta la columna obligatoria "${required}".` });
  }
  if (parsed.data.length === 0) errors.push({ row: 1, message: "El archivo no tiene filas de datos." });
  if (parsed.data.length > MAX_ROWS) errors.push({ row: 1, message: `Máximo ${MAX_ROWS} filas por archivo.` });
  if (errors.length) return { created: 0, updated: 0, productsCreated: 0, errors, applied: false };
  const rows = validateRows(parsed.data, 2, errors);
  if (!errors.length) assertImportPermissions(ctx, rows);
  return run(ctx, rows, errors, opts);
}

export async function exportProductsCsv(ctx: TenantContext): Promise<string> {
  requirePermission(ctx, "catalog.read");
  const rows = await withTenantTx(ctx, (tx) =>
    tx
      .select({
        producto: products.name,
        sku: productVariants.sku,
        variante: productVariants.name,
        optionValues: productVariants.optionValues,
        categoria: categories.name,
        marca: brands.name,
        codigo_barras: productVariants.barcode,
        codigo_referencia: productVariants.referenceCode,
        proveedor: suppliers.name,
        moneda_costo: productVariants.costCurrency,
        costo: productVariants.costAmount,
        costo_adicional: productVariants.extraCostCop,
        precio: productVariants.salePrice,
        retailMode: productVariants.retailPriceMode,
        precio_mayorista: productVariants.wholesalePrice,
        wholesaleMode: productVariants.wholesalePriceMode,
        minimo_mayorista: productVariants.wholesaleMinQty,
        margen_minorista: products.retailMargin,
        margen_mayorista: products.wholesaleMargin,
        impuesto: taxRates.name,
        stock_minimo: productVariants.lowStockThreshold,
        unidad: products.unit,
        descripcion: products.description,
        existencias: sql<string>`coalesce((select sum(sv.quantity) from stock_valuations sv where sv.variant_id = ${productVariants.id}), 0)`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(taxRates, eq(taxRates.id, products.taxRateId))
      .where(and(eq(productVariants.status, "active"), eq(products.status, "active")))
      .orderBy(products.name, productVariants.sku),
  );
  const data = rows.map((r) => ({
    ...r,
    opciones: Object.entries(r.optionValues)
      .map(([k, v]) => `${k}=${v}`)
      .join(";"),
    // Un precio automático se exporta como "auto" para que reimportar el archivo no lo convierta en manual.
    precio: r.retailMode === "auto" ? "auto" : r.precio,
    precio_mayorista: r.wholesaleMode === "auto" ? "auto" : r.precio_mayorista,
  }));
  // Neutraliza fórmulas al abrir en hojas de cálculo (inyección CSV).
  const safe = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  };
  return Papa.unparse({
    fields: [...CSV_COLUMNS],
    data: data.map((r) => CSV_COLUMNS.map((c) => safe((r as Record<string, unknown>)[c]))),
  });
}
