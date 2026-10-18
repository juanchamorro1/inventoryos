"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { formToObject, jsonField, withContext } from "@/server/actions/run";
import { importProductsCsv, type ImportResult } from "@/server/modules/catalog/csv";
import {
  createBrand,
  createCategory,
  createProductWithVariants,
  getProduct,
  createTaxRate,
  deleteBrand,
  deleteCategory,
  deleteTaxRate,
  setDefaultTaxRate,
  setProductImage,
  setProductStatus,
  updateProduct,
} from "@/server/modules/catalog/service";
import { deleteStoredFile, saveProductImage } from "@/server/storage";
import { postManualDocument } from "@/server/modules/inventory/service";
import { listLocationOptions } from "@/server/modules/warehouses/service";
import { can } from "@/server/platform/permissions";
import { normalizeNumber } from "@/lib/parse-number";
import { ValidationError } from "@/server/platform/errors";

function productPayload(form: FormData) {
  const data = formToObject(form);
  const empty = (v?: string) => (v ? v : null);
  return {
    name: data.name,
    description: data.description,
    categoryId: empty(data.categoryId),
    brandId: empty(data.brandId),
    categoryName: empty(data.categoryName),
    brandName: empty(data.brandName),
    taxRateId: empty(data.taxRateId),
    unit: data.unit || "unidad",
    attributes: jsonField(form, "attributes") ?? {},
    options: jsonField(form, "options") ?? [],
    variants: jsonField(form, "variants") ?? [],
  };
}

async function maybeSaveImage(form: FormData, ctx: Parameters<typeof setProductImage>[0], productId: string, previous?: string | null) {
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return;
  const path = await saveProductImage(ctx.organizationId, productId, file);
  await setProductImage(ctx, productId, path);
  if (previous) await deleteStoredFile(previous);
}

export async function createProductAction(_: ActionState, form: FormData): Promise<ActionState> {
  const payload = productPayload(form);
  const r = await withContext(async (ctx) => {
    const { productId, variantIds } = await createProductWithVariants(ctx, payload);
    await maybeSaveImage(form, ctx, productId);
    // Cantidad inicial opcional: se registra como ingreso de mercancía en la bodega principal.
    const variants = (payload.variants as { initialStock?: string }[]) ?? [];
    const lines = variants
      .map((v, i) => ({ variantId: variantIds[i]!, quantity: normalizeNumber(v.initialStock ?? "") ?? "0", raw: v }))
      .filter((l) => l.variantId && Number(l.quantity) > 0);
    let stockNote = "";
    if (lines.length) {
      if (!can(ctx, "inventory.write")) stockNote = "&stock=sin-permiso";
      else {
        const product = await getProduct(ctx, productId);
        const loc = (await listLocationOptions(ctx)).find((l) => l.isDefault && l.warehouseIsDefault);
        if (loc) {
          await postManualDocument(ctx, {
            type: "receipt",
            locationId: loc.id,
            reason: "Inventario inicial al crear el producto",
            lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitCost: product.variants.find((v) => v.id === l.variantId)?.costPrice ?? "0" })),
          });
        }
      }
    }
    return { productId, stockNote };
  });
  if (!r.ok) return r.state;
  revalidatePath("/products");
  redirect(`/products/${r.value.productId}?created=1${r.value.stockNote}`);
}

export async function updateProductAction(_: ActionState, form: FormData): Promise<ActionState> {
  const productId = String(form.get("productId") ?? "");
  const previousImage = String(form.get("previousImage") ?? "") || null;
  const r = await withContext(async (ctx) => {
    await updateProduct(ctx, productId, productPayload(form));
    await maybeSaveImage(form, ctx, productId, previousImage);
  });
  if (!r.ok) return r.state;
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?saved=1`);
}

export async function setProductStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const productId = String(form.get("productId") ?? "");
  const status = form.get("status") === "archived" ? "archived" : "active";
  const r = await withContext((ctx) => setProductStatus(ctx, productId, status));
  if (!r.ok) return r.state;
  revalidatePath(`/products/${productId}`);
  return { ok: true, message: status === "archived" ? "Producto archivado." : "Producto restaurado.", at: Date.now() };
}

export async function importCsvAction(_: ActionState, form: FormData): Promise<ActionState<ImportResult>> {
  const file = form.get("file");
  const dryRun = form.get("mode") !== "apply";
  const r = await withContext(async (ctx) => {
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Selecciona un archivo CSV.");
    if (file.size > 3 * 1024 * 1024) throw new ValidationError("El archivo supera 3 MB.");
    return importProductsCsv(ctx, await file.text(), { dryRun });
  });
  if (!r.ok) return r.state as ActionState<ImportResult>;
  const res = r.value;
  if (res.errors.length) return { ok: false, error: `Se encontraron ${res.errors.length} errores. No se aplicó ningún cambio.`, data: res, at: Date.now() };
  if (dryRun) {
    return {
      ok: true,
      message: `Validación correcta: se crearían ${res.created || "las"} variantes nuevas y se actualizarían las existentes. Pulsa «Importar» para aplicar.`,
      data: res,
      at: Date.now(),
    };
  }
  revalidatePath("/products");
  return { ok: true, message: `Importación aplicada: ${res.created} variantes nuevas (${res.productsCreated} productos) y ${res.updated} actualizadas.`, data: res, at: Date.now() };
}

// ---------- Categorías, marcas e impuestos ----------

function simple(fn: (ctx: Parameters<typeof createCategory>[0], form: FormData) => Promise<unknown>, message: string) {
  return async (_: ActionState, form: FormData): Promise<ActionState> => {
    const r = await withContext((ctx) => fn(ctx, form));
    if (!r.ok) return r.state;
    revalidatePath("/settings/catalog");
    return { ok: true, message, at: Date.now() };
  };
}

export const createCategoryAction = simple((ctx, f) => createCategory(ctx, formToObject(f)), "Categoría creada.");
export const deleteCategoryAction = simple((ctx, f) => deleteCategory(ctx, String(f.get("id"))), "Categoría eliminada.");
export const createBrandAction = simple((ctx, f) => createBrand(ctx, formToObject(f)), "Marca creada.");
export const deleteBrandAction = simple((ctx, f) => deleteBrand(ctx, String(f.get("id"))), "Marca eliminada.");
export const createTaxRateAction = simple(
  (ctx, f) => createTaxRate(ctx, { name: f.get("name"), rate: f.get("rate"), isDefault: f.get("isDefault") === "on" }),
  "Impuesto creado.",
);
export const setDefaultTaxRateAction = simple((ctx, f) => setDefaultTaxRate(ctx, String(f.get("id"))), "Impuesto predeterminado actualizado.");
export const deleteTaxRateAction = simple((ctx, f) => deleteTaxRate(ctx, String(f.get("id"))), "Impuesto eliminado.");
