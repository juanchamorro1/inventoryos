import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { storedFiles } from "./db/schema";
import { withTenantTx } from "./db/tx";
import { env } from "./env";
import type { TenantContext } from "./platform/context";
import { presignUrl } from "./s3-sign";

// Almacenamiento de objetos para imágenes. Dos drivers (STORAGE_DRIVER):
//   database: los bytes van a la tabla stored_files (RLS por empresa). Útil en desarrollo, pruebas y como transición.
//   s3:       almacenamiento compatible con S3. Las credenciales solo existen en el servidor; el navegador nunca
//             las ve: las subidas pasan por el servidor (que valida tipo y tamaño) y las lecturas se autorizan
//             en /api/images/<id> y redirigen a una URL prefirmada de 5 minutos.
// En PostgreSQL (product_images) solo se guardan los metadatos y la clave del objeto.

export type StoredObject = { kind: "data"; data: Buffer; contentType: string } | { kind: "redirect"; url: string };

export interface ObjectStore {
  driver: "database" | "s3";
  put(ctx: TenantContext, opts: { prefix: string; data: Buffer; contentType: string; extension: string }): Promise<string>;
  get(ctx: TenantContext, key: string): Promise<StoredObject | null>;
  delete(ctx: TenantContext, key: string): Promise<void>;
}

const databaseStore: ObjectStore = {
  driver: "database",
  async put(ctx, { data, contentType }) {
    const [row] = await withTenantTx(ctx, (tx) =>
      tx.insert(storedFiles).values({ organizationId: ctx.organizationId, contentType, size: data.length, data }).returning({ id: storedFiles.id }),
    );
    return row!.id;
  },
  async get(ctx, key) {
    const [row] = await withTenantTx(ctx, (tx) => tx.select({ data: storedFiles.data, contentType: storedFiles.contentType }).from(storedFiles).where(eq(storedFiles.id, key)));
    return row ? { kind: "data", data: row.data, contentType: row.contentType } : null;
  },
  async delete(ctx, key) {
    await withTenantTx(ctx, (tx) => tx.delete(storedFiles).where(eq(storedFiles.id, key)));
  },
};

function s3Config() {
  const e = env();
  return {
    endpoint: e.S3_ENDPOINT!.replace(/\/+$/, ""),
    bucket: e.S3_BUCKET!,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY!, region: e.S3_REGION },
  };
}

const objectUrl = (key: string) => {
  const c = s3Config();
  return `${c.endpoint}/${c.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
};

const s3Store: ObjectStore = {
  driver: "s3",
  async put(ctx, { prefix, data, contentType, extension }) {
    // La empresa va en la clave, pero la autorización real la da la fila de product_images (RLS).
    const key = `orgs/${ctx.organizationId}/${prefix}/${randomUUID()}.${extension}`;
    const url = presignUrl({ method: "PUT", url: objectUrl(key), credentials: s3Config().credentials, expiresSeconds: 300 });
    const res = await fetch(url, { method: "PUT", body: new Uint8Array(data), headers: { "Content-Type": contentType }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`El almacenamiento rechazó la subida (${res.status}).`);
    return key;
  },
  async get(_ctx, key) {
    return { kind: "redirect", url: presignUrl({ method: "GET", url: objectUrl(key), credentials: s3Config().credentials, expiresSeconds: 300 }) };
  },
  async delete(_ctx, key) {
    const url = presignUrl({ method: "DELETE", url: objectUrl(key), credentials: s3Config().credentials, expiresSeconds: 300 });
    const res = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(20_000) });
    if (!res.ok && res.status !== 404) throw new Error(`El almacenamiento rechazó el borrado (${res.status}).`);
  },
};

/** Store configurado para guardar objetos nuevos. */
export function objectStore(): ObjectStore {
  return env().STORAGE_DRIVER === "s3" ? s3Store : databaseStore;
}

/** Store con el que se guardó un objeto existente (permite convivir durante una migración de driver). */
export function storeFor(driver: "database" | "s3"): ObjectStore {
  return driver === "s3" ? s3Store : databaseStore;
}
