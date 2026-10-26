import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { brands, categories, productVariants, products, suppliers, taxRates } from "../../db/schema";
import { withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { costStr, D, type Dec, moneyStr, qtyStr } from "../../platform/decimal";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError, pgError, ValidationError } from "../../platform/errors";
import { can, requirePermission } from "../../platform/permissions";
import { assertWithinPlan } from "../../platform/plans";
import { optionalText, parseOrThrow, zDecimal, zMoney, zUnitCost, zUuid } from "../../platform/validation";
import { applyManualPriceTx, recalcTx, revertToAutoTx, settingsTx } from "../pricing/service";
import { primaryImageIdSql } from "./images";

// ---------- Categorías, marcas e impuestos ----------

const nameSchema = z.object({ name: z.string().trim().min(1, "Escribe un nombre.").max(80) });

type Lookup = typeof categories | typeof brands;

async function createLookup(ctx: TenantContext, table: Lookup, kind: string, raw: unknown) {
  requirePermission(ctx, "catalog.write");
  const { name } = parseOrThrow(nameSchema, raw);
  try {
    return await withTenantTx(ctx, async (tx) => {
      const [row] = await tx.insert(table).values({ organizationId: ctx.organizationId, name }).returning({ id: table.id });
      await audit(tx, ctx, `${kind}.created`, { type: kind, id: row!.id }, { name });
      return row!.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError("Ya existe uno con ese nombre.", { name: ["Ya existe uno con ese nombre."] });
    throw err;
  }
}

async function renameLookup(ctx: TenantContext, table: Lookup, kind: string, id: string, raw: unknown) {
  requirePermission(ctx, "catalog.write");
  const { name } = parseOrThrow(nameSchema, raw);
  try {
    await withTenantTx(ctx, async (tx) => {
      const updated = await tx.update(table).set({ name }).where(eq(table.id, id)).returning({ id: table.id });
      if (updated.length === 0) throw new NotFoundError();
      await audit(tx, ctx, `${kind}.renamed`, { type: kind, id }, { name });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError("Ya existe uno con ese nombre.", { name: ["Ya existe uno con ese nombre."] });
    throw err;
  }
}

async function deleteLookup(ctx: TenantContext, table: Lookup, kind: string, id: string) {
  requirePermission(ctx, "catalog.write");
  try {
    await withTenantTx(ctx, async (tx) => {
      const deleted = await tx.delete(table).where(eq(table.id, id)).returning({ id: table.id });
      if (deleted.length === 0) throw new NotFoundError();
      await audit(tx, ctx, `${kind}.deleted`, { type: kind, id });
    });
  } catch (err) {
    if (pgError(err)?.code === "23503") throw new ConflictError("No se puede eliminar porque hay productos que lo usan.");
    throw err;
  }
}

export const listCategories = (ctx: TenantContext) => {
  requirePermission(ctx, "catalog.read");
  return withTenantTx(ctx, (tx) =>
    tx
      .select({ id: categories.id, name: categories.name, products: sql<number>`(select count(*)::int from products p where p.category_id = ${categories.id})` })
      .from(categories)
      .orderBy(asc(categories.name)),
  );
};
export const listBrands = (ctx: TenantContext) => {
  requirePermission(ctx, "catalog.read");
  return withTenantTx(ctx, (tx) =>
    tx
      .select({ id: brands.id, name: brands.name, products: sql<number>`(select count(*)::int from products p where p.brand_id = ${brands.id})` })
      .from(brands)
      .orderBy(asc(brands.name)),
  );
};
export const createCategory = (ctx: TenantContext, raw: unknown) => createLookup(ctx, categories, "category", raw);
export const renameCategory = (ctx: TenantContext, id: string, raw: unknown) => renameLookup(ctx, categories, "category", id, raw);
export const deleteCategory = (ctx: TenantContext, id: string) => deleteLookup(ctx, categories, "category", id);
export const createBrand = (ctx: TenantContext, raw: unknown) => createLookup(ctx, brands, "brand", raw);
export const renameBrand = (ctx: TenantContext, id: string, raw: unknown) => renameLookup(ctx, brands, "brand", id, raw);
export const deleteBrand = (ctx: TenantContext, id: string) => deleteLookup(ctx, brands, "brand", id);

export function listTaxRates(ctx: TenantContext) {
  requirePermission(ctx, "catalog.read");
  return withTenantTx(ctx, (tx) => tx.select().from(taxRates).orderBy(desc(taxRates.isDefault), asc(taxRates.name)));
}

const taxSchema = z.object({
  name: z.string().trim().min(1, "Escribe un nombre.").max(60),
  rate: zDecimal({ scale: 4, min: 0, max: "100", label: "La tarifa" }),
  isDefault: z.boolean().default(false),
});

export async function createTaxRate(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const input = parseOrThrow(taxSchema, raw);
  try {
    return await withTenantTx(ctx, async (tx) => {
      if (input.isDefault) await tx.update(taxRates).set({ isDefault: false }).where(eq(taxRates.isDefault, true));
      const [row] = await tx
        .insert(taxRates)
        .values({ organizationId: ctx.organizationId, name: input.name, rate: input.rate.toFixed(4), isDefault: input.isDefault })
        .returning({ id: taxRates.id });
      await audit(tx, ctx, "tax_rate.created", { type: "tax_rate", id: row!.id }, { name: input.name, rate: input.rate.toString() });
      return row!.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError("Ya existe un impuesto con ese nombre.", { name: ["Nombre repetido."] });
    throw err;
  }
}

export async function setDefaultTaxRate(ctx: TenantContext, id: string) {
  requirePermission(ctx, "settings.manage");
  await withTenantTx(ctx, async (tx) => {
    const [exists] = await tx.select({ id: taxRates.id }).from(taxRates).where(eq(taxRates.id, id));
    if (!exists) throw new NotFoundError();
    await tx.update(taxRates).set({ isDefault: false }).where(ne(taxRates.id, id));
    await tx.update(taxRates).set({ isDefault: true }).where(eq(taxRates.id, id));
    await audit(tx, ctx, "tax_rate.default", { type: "tax_rate", id });
  });
}

export async function deleteTaxRate(ctx: TenantContext, id: string) {
  requirePermission(ctx, "settings.manage");
  try {
    await withTenantTx(ctx, async (tx) => {
      const deleted = await tx.delete(taxRates).where(eq(taxRates.id, id)).returning({ id: taxRates.id });
      if (deleted.length === 0) throw new NotFoundError();
      await audit(tx, ctx, "tax_rate.deleted", { type: "tax_rate", id });
    });
  } catch (err) {
    if (pgError(err)?.code === "23503") throw new ConflictError("No se puede eliminar: hay productos con este impuesto.");
    throw err;
  }
}

// ---------- Productos y variantes ----------

const skuSchema = z
  .string()
  .trim()
  .min(1, "El SKU es obligatorio.")
  .max(64, "Máximo 64 caracteres.")
  .regex(/^[A-Za-z0-9._\-/]+$/, "Usa solo letras, números, punto, guion, guion bajo o barra.");

const variantSchema = z.object({
  id: zUuid().optional(),
  // Vacío = se genera automáticamente.
  sku: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : undefined))
    .pipe(skuSchema.optional()),
  barcode: z
    .string()
    .trim()
    .max(64)
    .regex(/^[0-9A-Za-z\-]*$/, "Código de barras inválido.")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  name: z.string().trim().max(120).optional().default(""),
  optionValues: z.record(z.string().trim().max(60), z.string().trim().max(60)).default({}),
  referenceCode: z
    .string()
    .trim()
    .max(64, "El código de referencia admite máximo 64 caracteres.")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  /** Costo original en su moneda. `costPrice` se acepta como alias heredado (costo en COP). */
  costAmount: blankToUndefined(zUnitCost("El costo")).optional(),
  costPrice: blankToUndefined(zUnitCost("El costo de referencia")).optional(),
  costCurrency: z.enum(["COP", "USD"]).default("COP"),
  extraCostCop: blankToUndefined(zMoney("Los gastos adicionales")).optional(),
  /** Precio minorista manual. Vacío = automático (calculado con el costo y el margen). */
  salePrice: blankToNull(zMoney("El precio de venta")),
  /** Precio mayorista manual. Vacío = automático. */
  wholesalePrice: blankToNull(zMoney("El precio mayorista")),
  wholesaleMinQty: blankToNull(zDecimal({ scale: 4, positive: true, max: "99999999999999", label: "La cantidad mínima mayorista" })),
  lowStockThreshold: zDecimal({ scale: 4, min: 0, max: "99999999999999", label: "El stock mínimo" }),
});

function blankToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" || v === null ? undefined : v), schema);
}
function blankToNull<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" || v === undefined ? null : v), schema.nullable());
}

const marginField = (label: string) =>
  blankToNull(zDecimal({ scale: 4, min: 0, label }).refine((d) => d.lt(100), `${label}: debe ser menor que 100 (es un margen sobre el precio de venta).`));

export const productSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre del producto.").max(160),
  description: optionalText(4000),
  categoryId: zUuid("Categoría").optional().nullable(),
  brandId: zUuid("Marca").optional().nullable(),
  /** Alternativa a categoryId/brandId: se busca por nombre y se crea si no existe. */
  categoryName: z.string().trim().max(80).optional().nullable(),
  brandName: z.string().trim().max(80).optional().nullable(),
  taxRateId: zUuid("Impuesto").optional().nullable(),
  /** Proveedor habitual por nombre exacto (debe existir en Compras › Proveedores). */
  supplierName: z.string().trim().max(160).optional().nullable(),
  retailMargin: marginField("Margen minorista del producto"),
  wholesaleMargin: marginField("Margen mayorista del producto"),
  /** Confirma precios manuales por debajo del costo. */
  acceptBelowCost: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
  priceReason: z.string().trim().max(300).optional().nullable(),
  unit: z.string().trim().min(1).max(20).default("unidad"),
  attributes: z.record(z.string().trim().min(1).max(60), z.string().trim().max(200)).default({}),
  options: z
    .array(z.object({ name: z.string().trim().min(1).max(60), values: z.array(z.string().trim().min(1).max(60)).max(50) }))
    .max(5)
    .default([]),
  variants: z.array(variantSchema).min(1, "El producto debe tener al menos una variante.").max(200),
});
export type ProductInput = z.input<typeof productSchema>;

/** SKU automático: iniciales del producto + valores de opción + sufijo aleatorio corto. */
export function generateSku(productName: string, optionValues: Record<string, string>) {
  const clean = (t: string) =>
    t
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
  const words = clean(productName).split(" ").filter(Boolean);
  const base = (words.length > 1 ? words.slice(0, 3).map((w) => (/\d/.test(w) ? w : w.slice(0, 3))).join("") : (words[0] ?? "PRD").slice(0, 6)) || "PRD";
  const opts = Object.values(optionValues)
    .map((v) => clean(v).replace(/ /g, "").slice(0, 4))
    .filter(Boolean)
    .join("-");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return [base.slice(0, 12), opts, rand].filter(Boolean).join("-").slice(0, 64);
}

async function resolveLookup(tx: Parameters<Parameters<typeof withTenantTx>[1]>[0], ctx: TenantContext, table: Lookup, id: string | null | undefined, name: string | null | undefined) {
  if (id) return id;
  const n = name?.trim();
  if (!n) return null;
  const [found] = await tx.select({ id: table.id }).from(table).where(sql`lower(${table.name}) = ${n.toLowerCase()}`);
  if (found) return found.id;
  const [created] = await tx.insert(table).values({ organizationId: ctx.organizationId, name: n }).returning({ id: table.id });
  return created!.id;
}

function variantLabel(v: { name?: string; optionValues: Record<string, string> }) {
  if (v.name) return v.name;
  return Object.values(v.optionValues).filter(Boolean).join(" / ");
}

function translateCatalogError(err: unknown): never {
  if (isUniqueViolation(err, "product_variants_org_sku_uq")) {
    throw new ValidationError("Ya existe un producto con ese SKU en tu empresa.", { sku: ["SKU repetido."] });
  }
  if (isUniqueViolation(err, "product_variants_org_barcode_uq")) {
    throw new ValidationError("Ya existe un producto con ese código de barras.", { barcode: ["Código de barras repetido."] });
  }
  if (pgError(err)?.code === "23503") throw new ValidationError("La categoría, marca o impuesto seleccionado no existe.");
  throw err;
}

function checkDuplicates(input: z.output<typeof productSchema>) {
  const skus = input.variants.map((v) => v.sku?.toLowerCase()).filter((v): v is string => Boolean(v));
  if (new Set(skus).size !== skus.length) throw new ValidationError("Hay SKU repetidos entre las variantes.", { sku: ["SKU repetido."] });
  const codes = input.variants.map((v) => v.barcode).filter(Boolean);
  if (new Set(codes).size !== codes.length) throw new ValidationError("Hay códigos de barras repetidos entre las variantes.");
}

export async function createProduct(ctx: TenantContext, raw: unknown) {
  return (await createProductWithVariants(ctx, raw)).productId;
}

/** Igual que createProduct, pero devuelve también los IDs de variante en el orden recibido. */
export async function createProductWithVariants(ctx: TenantContext, raw: unknown): Promise<{ productId: string; variantIds: string[] }> {
  requirePermission(ctx, "catalog.write");
  const input = parseOrThrow(productSchema, raw);
  checkDuplicates(input);
  try {
    return await withTenantTx(ctx, async (tx) => {
      await assertWithinPlan(tx, ctx.organizationId, "variants", input.variants.length);
      const categoryId = await resolveLookup(tx, ctx, categories, input.categoryId, input.categoryName);
      const brandId = await resolveLookup(tx, ctx, brands, input.brandId, input.brandName);
      assertCanSetPrices(ctx, input);
      const supplierId = await resolveSupplier(tx, input.supplierName);
      const [p] = await tx
        .insert(products)
        .values({
          organizationId: ctx.organizationId,
          name: input.name,
          description: input.description,
          categoryId,
          brandId,
          taxRateId: input.taxRateId ?? null,
          supplierId,
          retailMargin: input.retailMargin?.toFixed(4) ?? null,
          wholesaleMargin: input.wholesaleMargin?.toFixed(4) ?? null,
          unit: input.unit,
          attributes: input.attributes,
          options: input.options,
          createdBy: ctx.userId,
        })
        .returning({ id: products.id });
      const inserted = await tx
        .insert(productVariants)
        .values(
          input.variants.map((v) => ({
            organizationId: ctx.organizationId,
            productId: p!.id,
            sku: v.sku ?? generateSku(input.name, v.optionValues),
            ...variantValues(input.name, v),
            // Con precio manual se crea ya en modo manual (el recálculo no lo toca); el precio se fija después
            // con su historial, una vez conocido el costo total.
            retailPriceMode: v.salePrice ? ("manual" as const) : ("auto" as const),
            wholesalePriceMode: v.wholesalePrice ? ("manual" as const) : ("auto" as const),
          })),
        )
        .returning({ id: productVariants.id });
      const ids = inserted.map((v) => v.id);
      await recalcTx(tx, ctx, { variantIds: ids, publishInitial: true, reason: "Producto creado" });
      await applyPriceIntents(tx, ctx, input, ids, new Map());
      await audit(tx, ctx, "product.created", { type: "product", id: p!.id }, { name: input.name, variants: input.variants.length });
      return { productId: p!.id, variantIds: ids };
    });
  } catch (err) {
    translateCatalogError(err);
  }
}

type VariantInput = z.output<typeof variantSchema>;
type ProductParsed = z.output<typeof productSchema>;

/** Campos de la variante comunes a crear y editar (sin precios publicados ni modos). */
function variantValues(productName: string, v: VariantInput) {
  const costAmount = v.costAmount ?? v.costPrice ?? new D(0);
  return {
    barcode: v.barcode,
    name: variantLabel(v),
    optionValues: v.optionValues,
    referenceCode: v.referenceCode,
    costAmount: costStr(costAmount),
    costCurrency: v.costCurrency,
    // En COP el costo de referencia es el mismo; en USD lo fija el recálculo cuando hay tasa.
    ...(v.costCurrency === "COP" ? { costPrice: costStr(costAmount) } : {}),
    extraCostCop: moneyStr(v.extraCostCop ?? new D(0)),
    wholesaleMinQty: v.wholesaleMinQty ? qtyStr(v.wholesaleMinQty) : null,
    lowStockThreshold: qtyStr(v.lowStockThreshold),
    updatedAt: new Date(),
  };
}

function assertCanSetPrices(ctx: TenantContext, input: ProductParsed) {
  const manual = input.variants.some((v) => v.salePrice || v.wholesalePrice) || input.retailMargin || input.wholesaleMargin;
  if (manual && !can(ctx, "pricing.manage")) throw new ForbiddenError("No tienes permiso para fijar precios o márgenes manuales.");
}

async function resolveSupplier(tx: Tx, name: string | null | undefined) {
  const n = name?.trim();
  if (!n) return null;
  const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = ${n.toLowerCase()}`).limit(1);
  if (!s) throw new ValidationError(`No existe el proveedor «${n}». Créalo en Compras › Proveedores o deja el campo vacío.`, { supplierName: ["Proveedor no encontrado."] });
  return s.id;
}

/**
 * Aplica los precios manuales pedidos en el formulario (o la vuelta a automático), con historial y verificación
 * de precios por debajo del costo. Se ejecuta DESPUÉS del recálculo para conocer el costo total.
 * `before` contiene el precio y el modo que tenía cada variante antes de esta edición.
 */
async function applyPriceIntents(tx: Tx, ctx: TenantContext, input: ProductParsed, ids: string[], before: Map<string, { salePrice: string; retailMode: "auto" | "manual"; wholesalePrice: string | null; wholesaleMode: "auto" | "manual" }>) {
  const rows = await tx.select().from(productVariants).where(inArray(productVariants.id, ids)).for("update");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const reason = input.priceReason || "Edición del producto";
  for (const [i, v] of input.variants.entries()) {
    const id = ids[i]!;
    for (const kind of ["retail", "wholesale"] as const) {
      const row = byId.get(id)!;
      const wanted: Dec | null = kind === "retail" ? v.salePrice : v.wholesalePrice;
      const prev = before.get(id);
      const prevMode = prev ? (kind === "retail" ? prev.retailMode : prev.wholesaleMode) : null;
      if (wanted) {
        const snapshot = prev ? { ...row, salePrice: prev.salePrice, wholesalePrice: prev.wholesalePrice, retailPriceMode: prev.retailMode, wholesalePriceMode: prev.wholesaleMode } : { ...row, salePrice: "0", wholesalePrice: null };
        await applyManualPriceTx(tx, ctx, { ...snapshot, pricingTotalCost: row.pricingTotalCost, costPrice: row.costPrice }, kind, wanted, reason, input.acceptBelowCost);
      } else if (prevMode === "manual") {
        await revertToAutoTx(tx, ctx, row, kind, reason);
      }
      const [fresh] = await tx.select().from(productVariants).where(eq(productVariants.id, id));
      byId.set(id, fresh!);
    }
  }
}

/** Actualiza el producto. Las variantes omitidas se archivan (pueden tener historial). */
export async function updateProduct(ctx: TenantContext, productId: string, raw: unknown) {
  requirePermission(ctx, "catalog.write");
  const input = parseOrThrow(productSchema, raw);
  checkDuplicates(input);
  try {
    await withTenantTx(ctx, async (tx) => {
      const [current] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).for("update");
      if (!current) throw new NotFoundError("Producto no encontrado.");
      assertCanSetPrices(ctx, input);
      const categoryId = await resolveLookup(tx, ctx, categories, input.categoryId, input.categoryName);
      const brandId = await resolveLookup(tx, ctx, brands, input.brandId, input.brandName);
      const supplierId = await resolveSupplier(tx, input.supplierName);
      await tx
        .update(products)
        .set({
          name: input.name,
          description: input.description,
          categoryId,
          brandId,
          taxRateId: input.taxRateId ?? null,
          supplierId,
          retailMargin: input.retailMargin?.toFixed(4) ?? null,
          wholesaleMargin: input.wholesaleMargin?.toFixed(4) ?? null,
          unit: input.unit,
          attributes: input.attributes,
          options: input.options,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId));
      const existing = await tx
        .select({ id: productVariants.id, salePrice: productVariants.salePrice, retailMode: productVariants.retailPriceMode, wholesalePrice: productVariants.wholesalePrice, wholesaleMode: productVariants.wholesalePriceMode })
        .from(productVariants)
        .where(eq(productVariants.productId, productId))
        .for("update");
      const before = new Map(existing.map((v) => [v.id, v]));
      const existingIds = new Set(existing.map((v) => v.id));
      const keepIds = new Set(input.variants.filter((v) => v.id).map((v) => v.id!));
      for (const id of keepIds) if (!existingIds.has(id)) throw new ValidationError("Una variante no pertenece a este producto.");
      const toArchive = [...existingIds].filter((id) => !keepIds.has(id));
      if (toArchive.length) {
        await tx.update(productVariants).set({ status: "archived", updatedAt: new Date() }).where(inArray(productVariants.id, toArchive));
      }
      const newOnes = input.variants.filter((v) => !v.id);
      if (newOnes.length) await assertWithinPlan(tx, ctx.organizationId, "variants", newOnes.length);
      const ids: string[] = [];
      for (const v of input.variants) {
        const values = { sku: v.sku ?? generateSku(input.name, v.optionValues), ...variantValues(input.name, v) };
        // Quien pide un precio manual lo pasa a modo manual ANTES del recálculo para que este no publique un automático.
        const modes = {
          ...(v.salePrice ? { retailPriceMode: "manual" as const } : {}),
          ...(v.wholesalePrice ? { wholesalePriceMode: "manual" as const } : {}),
        };
        if (v.id) {
          await tx.update(productVariants).set({ ...values, ...modes, status: "active" }).where(eq(productVariants.id, v.id));
          ids.push(v.id);
        } else {
          const [row] = await tx
            .insert(productVariants)
            .values({ ...values, ...modes, organizationId: ctx.organizationId, productId })
            .returning({ id: productVariants.id });
          ids.push(row!.id);
        }
      }
      // Costos o márgenes pudieron cambiar: se recalculan los sugeridos de todo el producto (según la política).
      await recalcTx(tx, ctx, { variantIds: ids, publishInitial: true, reason: "Producto editado" });
      await applyPriceIntents(tx, ctx, input, ids, before);
      await audit(tx, ctx, "product.updated", { type: "product", id: productId }, { name: input.name, archivedVariants: toArchive.length });
    });
  } catch (err) {
    translateCatalogError(err);
  }
}

export async function setProductStatus(ctx: TenantContext, productId: string, status: "active" | "archived") {
  requirePermission(ctx, "catalog.write");
  await withTenantTx(ctx, async (tx) => {
    const updated = await tx.update(products).set({ status, updatedAt: new Date() }).where(eq(products.id, productId)).returning({ id: products.id });
    if (updated.length === 0) throw new NotFoundError("Producto no encontrado.");
    await tx.update(productVariants).set({ status, updatedAt: new Date() }).where(eq(productVariants.productId, productId));
    await audit(tx, ctx, status === "archived" ? "product.archived" : "product.restored", { type: "product", id: productId });
  });
}

export async function setProductImage(ctx: TenantContext, productId: string, imagePath: string | null) {
  requirePermission(ctx, "catalog.write");
  await withTenantTx(ctx, async (tx) => {
    const updated = await tx.update(products).set({ imagePath, updatedAt: new Date() }).where(eq(products.id, productId)).returning({ id: products.id });
    if (updated.length === 0) throw new NotFoundError("Producto no encontrado.");
    await audit(tx, ctx, "product.image", { type: "product", id: productId }, { imagePath });
  });
}

export type ProductSort = "name" | "price_asc" | "price_desc" | "updated" | "created";
export type PricingFilter = "manual" | "pending" | "no_rate" | "below_cost";
export type ProductFilters = {
  search?: string;
  categoryId?: string;
  brandId?: string;
  status?: "active" | "archived";
  currency?: "COP" | "USD";
  pricing?: PricingFilter;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
};

const totalQty = sql<string>`coalesce((select sum(sv.quantity) from stock_valuations sv join product_variants v2 on v2.id = sv.variant_id where v2.product_id = ${products.id}), 0)`;

export async function listProducts(ctx: TenantContext, f: ProductFilters = {}) {
  requirePermission(ctx, "catalog.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, f.pageSize ?? 25);
  const uuidOk = (v?: string) => (v && z.string().uuid().safeParse(v).success ? v : undefined);
  return withTenantTx(ctx, async (tx) => {
    const conds: SQL[] = [eq(products.status, f.status ?? "active")];
    const categoryId = uuidOk(f.categoryId);
    const brandId = uuidOk(f.brandId);
    if (categoryId) conds.push(eq(products.categoryId, categoryId));
    if (brandId) conds.push(eq(products.brandId, brandId));
    if (f.search) {
      const q = `%${f.search.trim().slice(0, 100)}%`;
      conds.push(
        or(
          ilike(products.name, q),
          sql`exists (select 1 from product_variants v where v.product_id = ${products.id} and (v.sku ilike ${q} or v.barcode ilike ${q} or v.name ilike ${q} or v.reference_code ilike ${q}))`,
        )!,
      );
    }
    if (f.currency) conds.push(sql`exists (select 1 from product_variants v where v.product_id = ${products.id} and v.status = 'active' and v.cost_currency = ${f.currency})`);
    if (f.pricing === "manual") conds.push(sql`exists (select 1 from product_variants v where v.product_id = ${products.id} and v.status = 'active' and (v.retail_price_mode = 'manual' or v.wholesale_price_mode = 'manual'))`);
    if (f.pricing === "no_rate") conds.push(sql`exists (select 1 from product_variants v where v.product_id = ${products.id} and v.status = 'active' and v.pricing_status = 'no_rate')`);
    if (f.pricing === "below_cost")
      conds.push(sql`exists (select 1 from product_variants v where v.product_id = ${products.id} and v.status = 'active' and v.pricing_total_cost is not null and (v.sale_price < v.pricing_total_cost or v.wholesale_price < v.pricing_total_cost))`);
    if (f.pricing === "pending") {
      const s = await settingsTx(tx, ctx.organizationId);
      const step = sql.raw(`${new D(s.roundingStep).toFixed(4)}::numeric`);
      const r = (col: string) => (s.roundingMode === "none" ? sql.raw(`round(v.${col}, 2)`) : s.roundingMode === "up" ? sql`(ceil(${sql.raw(`v.${col}`)} / ${step}) * ${step})` : sql`(round(${sql.raw(`v.${col}`)} / ${step}) * ${step})`);
      conds.push(
        sql`exists (select 1 from product_variants v where v.product_id = ${products.id} and v.status = 'active' and v.pricing_status = 'ok' and (
          (v.retail_price_mode = 'auto' and v.suggested_retail_price is not null and v.sale_price <> ${r("suggested_retail_price")})
          or (v.wholesale_price_mode = 'auto' and v.suggested_wholesale_price is not null and v.wholesale_price is distinct from ${r("suggested_wholesale_price")})))`,
      );
    }
    const minPrice = sql<string | null>`(select min(v.sale_price) from product_variants v where v.product_id = ${products.id} and v.status = 'active')`;
    const order =
      f.sort === "price_asc"
        ? [sql`${minPrice} asc nulls last`, asc(products.name)]
        : f.sort === "price_desc"
          ? [sql`${minPrice} desc nulls last`, asc(products.name)]
          : f.sort === "updated"
            ? [desc(products.updatedAt)]
            : f.sort === "created"
              ? [desc(products.createdAt)]
              : [asc(products.name)];
    const where = and(...conds);
    const rows = await tx
      .select({
        id: products.id,
        name: products.name,
        imagePath: products.imagePath,
        primaryImageId: primaryImageIdSql(products.id),
        status: products.status,
        categoryName: categories.name,
        brandName: brands.name,
        variantCount: sql<number>`(select count(*)::int from product_variants v where v.product_id = ${products.id} and v.status = 'active')`,
        skus: sql<string>`(select string_agg(v.sku, ', ' order by v.sku) from (select sku from product_variants v where v.product_id = ${products.id} and v.status = 'active' order by sku limit 3) v)`,
        minPrice,
        maxPrice: sql<string | null>`(select max(v.sale_price) from product_variants v where v.product_id = ${products.id} and v.status = 'active')`,
        minWholesale: sql<string | null>`(select min(v.wholesale_price) from product_variants v where v.product_id = ${products.id} and v.status = 'active')`,
        currencies: sql<string>`coalesce((select string_agg(distinct v.cost_currency, ',') from product_variants v where v.product_id = ${products.id} and v.status = 'active'), '')`,
        manualCount: sql<number>`(select count(*)::int from product_variants v where v.product_id = ${products.id} and v.status = 'active' and (v.retail_price_mode = 'manual' or v.wholesale_price_mode = 'manual'))`,
        noRateCount: sql<number>`(select count(*)::int from product_variants v where v.product_id = ${products.id} and v.status = 'active' and v.pricing_status = 'no_rate')`,
        quantity: totalQty,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx.select({ n: count() }).from(products).where(where);
    return { rows, total: total?.n ?? 0, page, pageSize };
  });
}

export async function getProduct(ctx: TenantContext, productId: string) {
  requirePermission(ctx, "catalog.read");
  if (!z.string().uuid().safeParse(productId).success) throw new NotFoundError("Producto no encontrado.");
  return withTenantTx(ctx, async (tx) => {
    const [p] = await tx
      .select({ product: products, categoryName: categories.name, brandName: brands.name, taxName: taxRates.name, taxRate: taxRates.rate, supplierName: suppliers.name })
      .from(products)
      .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(taxRates, eq(taxRates.id, products.taxRateId))
      .where(eq(products.id, productId));
    if (!p) throw new NotFoundError("Producto no encontrado.");
    const variants = await tx
      .select({
        variant: productVariants,
        quantity: sql<string>`coalesce((select sum(sv.quantity) from stock_valuations sv where sv.variant_id = ${productVariants.id}), 0)`,
        value: sql<string>`coalesce((select sum(sv.total_value) from stock_valuations sv where sv.variant_id = ${productVariants.id}), 0)`,
      })
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(asc(productVariants.status), asc(productVariants.sku));
    return {
      ...p.product,
      categoryName: p.categoryName,
      brandName: p.brandName,
      taxName: p.taxName,
      taxRate: p.taxRate,
      supplierName: p.supplierName,
      variants: variants.map((v) => ({ ...v.variant, quantity: v.quantity, value: v.value })),
    };
  });
}

export type VariantOption = {
  variantId: string;
  sku: string;
  label: string;
  barcode: string | null;
  salePrice: string;
  costPrice: string;
  taxRate: string;
  unit: string;
  available: string | null;
};

/** Búsqueda para selectores (ventas, compras, movimientos). Con locationId incluye el disponible en esa ubicación. */
export async function searchVariants(ctx: TenantContext, q: string, opts: { locationId?: string; limit?: number } = {}): Promise<VariantOption[]> {
  requirePermission(ctx, "catalog.read");
  const term = q.trim();
  return withTenantTx(ctx, async (tx) => {
    const conds: SQL[] = [eq(productVariants.status, "active"), eq(products.status, "active")];
    if (term) {
      const like = `%${term}%`;
      conds.push(or(ilike(productVariants.sku, like), ilike(products.name, like), ilike(productVariants.name, like), eq(productVariants.barcode, term), ilike(productVariants.referenceCode, like))!);
    }
    const available = opts.locationId
      ? sql<string | null>`(select b.on_hand from stock_balances b where b.variant_id = ${productVariants.id} and b.location_id = ${opts.locationId})`
      : sql<string | null>`(select sum(sv.quantity) from stock_valuations sv where sv.variant_id = ${productVariants.id})`;
    const rows = await tx
      .select({
        variantId: productVariants.id,
        sku: productVariants.sku,
        productName: products.name,
        variantName: productVariants.name,
        barcode: productVariants.barcode,
        salePrice: productVariants.salePrice,
        costPrice: productVariants.costPrice,
        taxRate: sql<string>`coalesce(${taxRates.rate}, 0)`,
        unit: products.unit,
        available,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(taxRates, eq(taxRates.id, products.taxRateId))
      .where(and(...conds))
      .orderBy(sql`case when lower(${productVariants.sku}) = lower(${term}) or ${productVariants.barcode} = ${term} then 0 else 1 end`, asc(products.name), asc(productVariants.sku))
      .limit(Math.min(opts.limit ?? 20, 50));
    return rows.map((r) => ({
      variantId: r.variantId,
      sku: r.sku,
      label: r.variantName ? `${r.productName} · ${r.variantName}` : r.productName,
      barcode: r.barcode,
      salePrice: r.salePrice,
      costPrice: r.costPrice,
      taxRate: r.taxRate,
      unit: r.unit,
      available: r.available ?? (opts.locationId ? "0" : null),
    }));
  });
}
