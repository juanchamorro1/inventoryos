import { and, eq, sql } from "drizzle-orm";
import Papa from "papaparse";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { brands, categories, productVariants, products, taxRates } from "../../db/schema";
import { withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { costStr, moneyStr, qtyStr } from "../../platform/decimal";
import { requirePermission } from "../../platform/permissions";
import { assertWithinPlan } from "../../platform/plans";
import { zDecimal, zMoney, zUnitCost } from "../../platform/validation";

export const CSV_COLUMNS = [
  "producto",
  "sku",
  "variante",
  "opciones",
  "categoria",
  "marca",
  "codigo_barras",
  "costo",
  "precio",
  "impuesto",
  "stock_minimo",
  "unidad",
  "descripcion",
  "existencias",
] as const;

const MAX_ROWS = 5000;

const blankToZero = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? "0" : v);

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
  costo: z.preprocess(blankToZero, zUnitCost("costo")),
  precio: z.preprocess(blankToZero, zMoney("precio")),
  impuesto: z.string().trim().default(""),
  stock_minimo: z.preprocess(blankToZero, zDecimal({ scale: 4, min: 0, label: "stock_minimo" })),
  unidad: z.string().trim().max(20).default("unidad"),
  descripcion: z.string().trim().max(4000).default(""),
});

export type ImportRowError = { row: number; message: string };
export type ImportResult = { created: number; updated: number; productsCreated: number; errors: ImportRowError[]; applied: boolean };

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

/**
 * Importa productos desde CSV (separado por comas o punto y coma, UTF-8, con encabezados).
 * Cada fila es una variante; las filas con el mismo "producto" se agrupan. Si el SKU existe se actualiza.
 * Es todo o nada: si alguna fila tiene errores no se aplica ningún cambio.
 */
export async function importProductsCsv(ctx: TenantContext, text: string, opts: { dryRun?: boolean } = {}): Promise<ImportResult> {
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

  type Row = z.output<typeof rowSchema> & { line: number; optionValues: Record<string, string> };
  const rows: Row[] = [];
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const r = rowSchema.safeParse(raw);
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
  if (errors.length) return { created: 0, updated: 0, productsCreated: 0, errors, applied: false };

  class Abort extends Error {}
  try {
    return await withTenantTx(ctx, async (tx) => {
      const taxes = await tx.select().from(taxRates);
      const resolveTax = (value: string) => {
        if (!value) return { id: taxes.find((t) => t.isDefault)?.id ?? null };
        const name = value.trim().toLowerCase();
        const rate = name.replace("%", "").trim();
        const t =
          taxes.find((x) => x.name.toLowerCase() === name) ??
          (/^\d+(\.\d+)?$/.test(rate) ? taxes.find((x) => Number(x.rate) === Number(rate)) : undefined);
        return t ? { id: t.id } : null;
      };
      const catCache = new Map<string, string>();
      const brandCache = new Map<string, string>();
      const productCache = new Map<string, string>();
      let created = 0;
      let updated = 0;
      let productsCreated = 0;

      for (const row of rows) {
        const tax = resolveTax(row.impuesto);
        if (!tax) {
          errors.push({ row: row.line, message: `impuesto "${row.impuesto}" no existe. Créalo en Configuración › Impuestos.` });
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
          categoryId,
          brandId,
          taxRateId: tax.id,
          unit: row.unidad || "unidad",
          ...(row.descripcion ? { description: row.descripcion } : {}),
          updatedAt: new Date(),
        };
        const variantFields = {
          barcode: row.codigo_barras || null,
          name: row.variante || Object.values(row.optionValues).join(" / "),
          optionValues: row.optionValues,
          costPrice: costStr(row.costo),
          salePrice: moneyStr(row.precio),
          lowStockThreshold: qtyStr(row.stock_minimo),
          status: "active",
          updatedAt: new Date(),
        };
        const [existing] = await tx
          .select({ id: productVariants.id, productId: productVariants.productId })
          .from(productVariants)
          .where(sql`lower(${productVariants.sku}) = ${row.sku.toLowerCase()}`);
        if (existing) {
          await tx.update(productVariants).set(variantFields).where(eq(productVariants.id, existing.id));
          await tx.update(products).set({ ...productFields, name: row.producto, status: "active" }).where(eq(products.id, existing.productId));
          updated++;
          continue;
        }
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
              .values({ organizationId: ctx.organizationId, name: row.producto, createdBy: ctx.userId, ...productFields })
              .returning({ id: products.id });
            productId = p!.id;
            productsCreated++;
          }
          productCache.set(pKey, productId);
        }
        await tx.insert(productVariants).values({ organizationId: ctx.organizationId, productId, sku: row.sku, ...variantFields });
        created++;
      }
      if (errors.length) throw new Abort();
      await assertWithinPlan(tx, ctx.organizationId, "variants", 0);
      if (opts.dryRun) throw new Abort();
      await audit(tx, ctx, "product.imported", { type: "product" }, { created, updated, productsCreated });
      return { created, updated, productsCreated, errors, applied: true };
    });
  } catch (err) {
    if (err instanceof Abort) {
      return { created: 0, updated: 0, productsCreated: 0, errors, applied: false };
    }
    throw err;
  }
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
        costo: productVariants.costPrice,
        precio: productVariants.salePrice,
        impuesto: taxRates.name,
        stock_minimo: productVariants.lowStockThreshold,
        unidad: products.unit,
        descripcion: products.description,
        existencias: sql<string>`coalesce((select sum(sv.quantity) from stock_valuations sv where sv.variant_id = ${productVariants.id}), 0)`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
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

