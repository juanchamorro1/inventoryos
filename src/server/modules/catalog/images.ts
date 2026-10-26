import "server-only";
import { and, asc, count, eq, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { productImages, products } from "../../db/schema";
import { withTenantTx } from "../../db/tx";
import { objectStore, storeFor, type StoredObject } from "../../object-storage";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { ConflictError, NotFoundError, ValidationError } from "../../platform/errors";
import { requirePermission } from "../../platform/permissions";
import { IMAGE_TYPES } from "../../storage";

// Fotografías de productos: varias por producto, una principal, orden y texto alternativo.
// El archivo va al almacenamiento de objetos configurado; aquí solo se guardan metadatos y referencia.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 10;
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const altSchema = z.string().trim().max(200, "El texto alternativo admite máximo 200 caracteres.");
const idSchema = z.string().uuid();

export type ProductImage = { id: string; altText: string; position: number; isPrimary: boolean; contentType: string; size: number; url: string };

const toView = (r: { id: string; altText: string; position: number; isPrimary: boolean; contentType: string; size: number }): ProductImage => ({ ...r, url: `/api/images/${r.id}` });

export async function listProductImages(ctx: TenantContext, productId: string): Promise<ProductImage[]> {
  requirePermission(ctx, "catalog.read");
  if (!idSchema.safeParse(productId).success) return [];
  const rows = await withTenantTx(ctx, (tx) =>
    tx
      .select({ id: productImages.id, altText: productImages.altText, position: productImages.position, isPrimary: productImages.isPrimary, contentType: productImages.contentType, size: productImages.size })
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .orderBy(asc(productImages.position), asc(productImages.createdAt)),
  );
  return rows.map(toView);
}

/** Valida el tipo REAL del archivo (firma de bytes), no el que declara el navegador. */
export async function readImageFile(file: File): Promise<{ data: Buffer; contentType: string }> {
  if (file.size === 0) throw new ValidationError("El archivo está vacío.", { image: ["Archivo vacío."] });
  if (file.size > MAX_IMAGE_BYTES) throw new ValidationError("La foto pesa más de 2 MB.", { image: ["Máximo 2 MB."] });
  const data = Buffer.from(await file.arrayBuffer());
  const contentType = Object.entries(IMAGE_TYPES).find(([, magic]) => magic(data))?.[0];
  if (!contentType) throw new ValidationError("Formato de imagen no permitido. Usa una foto JPG, PNG o WEBP.", { image: ["Usa JPG, PNG o WEBP."] });
  return { data, contentType };
}

export async function addProductImage(ctx: TenantContext, productId: string, file: File, altText?: string): Promise<string> {
  requirePermission(ctx, "catalog.write");
  if (!idSchema.safeParse(productId).success) throw new NotFoundError("Producto no encontrado.");
  const alt = altSchema.parse(altText ?? "");
  const { data, contentType } = await readImageFile(file);
  // Autorización y cupo ANTES de subir el archivo.
  const name = await withTenantTx(ctx, async (tx) => {
    const [p] = await tx.select({ name: products.name }).from(products).where(eq(products.id, productId));
    if (!p) throw new NotFoundError("Producto no encontrado.");
    const [n] = await tx.select({ n: count() }).from(productImages).where(eq(productImages.productId, productId));
    if ((n?.n ?? 0) >= MAX_IMAGES_PER_PRODUCT) throw new ConflictError(`Cada producto admite máximo ${MAX_IMAGES_PER_PRODUCT} fotos.`);
    return p.name;
  });
  const store = objectStore();
  const key = await store.put(ctx, { prefix: `products/${productId}`, data, contentType, extension: EXTENSIONS[contentType]! });
  try {
    return await withTenantTx(ctx, async (tx) => {
      await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).for("update");
      const [n] = await tx.select({ n: count(), pos: max(productImages.position) }).from(productImages).where(eq(productImages.productId, productId));
      if ((n?.n ?? 0) >= MAX_IMAGES_PER_PRODUCT) throw new ConflictError(`Cada producto admite máximo ${MAX_IMAGES_PER_PRODUCT} fotos.`);
      const [row] = await tx
        .insert(productImages)
        .values({
          organizationId: ctx.organizationId,
          productId,
          storageDriver: store.driver,
          storageKey: key,
          contentType,
          size: data.length,
          altText: alt || name,
          position: (n?.pos ?? -1) + 1,
          isPrimary: (n?.n ?? 0) === 0,
          createdBy: ctx.userId,
        })
        .returning({ id: productImages.id });
      await audit(tx, ctx, "product.image_added", { type: "product", id: productId }, { imageId: row!.id, size: data.length, contentType });
      return row!.id;
    });
  } catch (err) {
    // Si no quedó registrada, el objeto subido no debe quedar huérfano.
    await store.delete(ctx, key).catch((e) => console.error("[images] no se pudo borrar un objeto huérfano", e));
    throw err;
  }
}

async function lockImage(tx: Tx, imageId: string) {
  if (!idSchema.safeParse(imageId).success) throw new NotFoundError("Foto no encontrada.");
  const [img] = await tx.select().from(productImages).where(eq(productImages.id, imageId)).for("update");
  if (!img) throw new NotFoundError("Foto no encontrada.");
  return img;
}

export async function setPrimaryImage(ctx: TenantContext, imageId: string) {
  requirePermission(ctx, "catalog.write");
  await withTenantTx(ctx, async (tx) => {
    const img = await lockImage(tx, imageId);
    await tx.update(productImages).set({ isPrimary: false }).where(and(eq(productImages.productId, img.productId), eq(productImages.isPrimary, true)));
    await tx.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, imageId));
    await audit(tx, ctx, "product.image_primary", { type: "product", id: img.productId }, { imageId });
  });
}

export async function moveProductImage(ctx: TenantContext, imageId: string, direction: "up" | "down") {
  requirePermission(ctx, "catalog.write");
  await withTenantTx(ctx, async (tx) => {
    const img = await lockImage(tx, imageId);
    const all = await tx.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, img.productId)).orderBy(asc(productImages.position), asc(productImages.createdAt)).for("update");
    const i = all.findIndex((x) => x.id === imageId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j]!, all[i]!];
    // Renumera 0..n−1 (también corrige huecos).
    for (const [pos, x] of all.entries()) await tx.update(productImages).set({ position: pos }).where(eq(productImages.id, x.id));
  });
}

export async function updateImageAlt(ctx: TenantContext, imageId: string, altText: unknown) {
  requirePermission(ctx, "catalog.write");
  const parsed = altSchema.min(1, "Escribe una descripción breve de la foto.").safeParse(altText);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]!.message, { altText: [parsed.error.issues[0]!.message] });
  await withTenantTx(ctx, async (tx) => {
    const img = await lockImage(tx, imageId);
    await tx.update(productImages).set({ altText: parsed.data }).where(eq(productImages.id, imageId));
    await audit(tx, ctx, "product.image_alt", { type: "product", id: img.productId }, { imageId });
  });
}

export async function deleteProductImage(ctx: TenantContext, imageId: string) {
  requirePermission(ctx, "catalog.write");
  const removed = await withTenantTx(ctx, async (tx) => {
    const img = await lockImage(tx, imageId);
    await tx.delete(productImages).where(eq(productImages.id, imageId));
    if (img.isPrimary) {
      // La siguiente en el orden pasa a ser la principal.
      const [next] = await tx.select({ id: productImages.id }).from(productImages).where(and(eq(productImages.productId, img.productId), ne(productImages.id, imageId))).orderBy(asc(productImages.position)).limit(1);
      if (next) await tx.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, next.id));
    }
    await audit(tx, ctx, "product.image_deleted", { type: "product", id: img.productId }, { imageId });
    return img;
  });
  await storeFor(removed.storageDriver).delete(ctx, removed.storageKey).catch((e) => console.error("[images] no se pudo borrar el objeto", e));
}

/** Para servir una foto: la fila se busca con el contexto de la empresa (RLS), así nadie lee fotos ajenas. */
export async function readProductImage(ctx: TenantContext, imageId: string): Promise<StoredObject | null> {
  requirePermission(ctx, "catalog.read");
  if (!idSchema.safeParse(imageId).success) return null;
  const [img] = await withTenantTx(ctx, (tx) => tx.select({ driver: productImages.storageDriver, key: productImages.storageKey }).from(productImages).where(eq(productImages.id, imageId)));
  if (!img) return null;
  return storeFor(img.driver).get(ctx, img.key);
}

/** Subconsulta: id de la foto principal de un producto (para listados sin cargar archivos). */
export const primaryImageIdSql = (productIdColumn: unknown) =>
  sql<string | null>`(select pi.id from product_images pi where pi.product_id = ${productIdColumn} and pi.is_primary limit 1)`;
