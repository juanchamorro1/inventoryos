import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { ValidationError } from "./platform/errors";

// Almacenamiento local de imágenes de productos, fuera de /public: se sirven por /api/files tras
// verificar que el archivo pertenece a la empresa de la sesión. Para producción multi-servidor,
// reemplazar por un almacenamiento de objetos (S3 o compatible) con la misma interfaz.

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { ext: "webp", magic: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
};

const root = () => path.resolve(env().STORAGE_DIR);

function safeResolve(relative: string) {
  const full = path.resolve(root(), relative);
  if (!full.startsWith(root() + path.sep)) throw new ValidationError("Ruta de archivo inválida.");
  return full;
}

export async function saveProductImage(organizationId: string, productId: string, file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new ValidationError("La imagen supera 2 MB.", { image: ["Máximo 2 MB."] });
  const buffer = Buffer.from(await file.arrayBuffer());
  const type = Object.entries(TYPES).find(([, t]) => t.magic(buffer));
  if (!type) throw new ValidationError("Formato de imagen no permitido. Usa PNG, JPG o WEBP.", { image: ["Usa PNG, JPG o WEBP."] });
  const relative = path.posix.join("products", organizationId, `${productId}-${randomUUID().slice(0, 8)}.${type[1].ext}`);
  const full = safeResolve(relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buffer);
  return relative;
}

export async function readStoredFile(relative: string): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const data = await readFile(safeResolve(relative));
    const ext = path.extname(relative).slice(1);
    const contentType = Object.entries(TYPES).find(([, t]) => t.ext === ext)?.[0] ?? "application/octet-stream";
    return { data, contentType };
  } catch {
    return null;
  }
}

export async function deleteStoredFile(relative: string) {
  await rm(safeResolve(relative), { force: true }).catch(() => {});
}
