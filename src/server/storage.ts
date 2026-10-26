import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { storedFiles } from "./db/schema";
import { withTenantTx } from "./db/tx";
import type { TenantContext } from "./platform/context";
import { ValidationError } from "./platform/errors";

// Imágenes de productos guardadas en PostgreSQL (tabla stored_files, protegida por RLS).
// Así la app funciona igual en un servidor propio y en plataformas sin disco persistente (Vercel).
// La referencia que se guarda en products.image_path es "files/<id>".

const MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};

const PREFIX = "files/";

/** Extrae el id de una referencia "files/<id>"; null si no es válida. */
export function fileIdFromPath(path: string | null | undefined): string | null {
  if (!path?.startsWith(PREFIX)) return null;
  const id = path.slice(PREFIX.length);
  return z.string().uuid().safeParse(id).success ? id : null;
}

export async function saveProductImage(ctx: TenantContext, file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new ValidationError("La foto pesa más de 2 MB.", { image: ["Máximo 2 MB."] });
  const data = Buffer.from(await file.arrayBuffer());
  const type = Object.entries(IMAGE_TYPES).find(([, magic]) => magic(data))?.[0];
  if (!type) throw new ValidationError("Formato de imagen no permitido. Usa una foto JPG, PNG o WEBP.", { image: ["Usa JPG, PNG o WEBP."] });
  const [row] = await withTenantTx(ctx, (tx) =>
    tx.insert(storedFiles).values({ organizationId: ctx.organizationId, contentType: type, size: data.length, data }).returning({ id: storedFiles.id }),
  );
  return `${PREFIX}${row!.id}`;
}

export async function readStoredFile(ctx: TenantContext, path: string): Promise<{ data: Buffer; contentType: string } | null> {
  const id = fileIdFromPath(path);
  if (!id) return null;
  const [row] = await withTenantTx(ctx, (tx) => tx.select({ data: storedFiles.data, contentType: storedFiles.contentType }).from(storedFiles).where(eq(storedFiles.id, id)));
  return row ?? null;
}

export async function deleteStoredFile(ctx: TenantContext, path: string) {
  const id = fileIdFromPath(path);
  if (!id) return;
  await withTenantTx(ctx, (tx) => tx.delete(storedFiles).where(eq(storedFiles.id, id)));
}
