import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { apiKeys, auditLogs, memberships, users } from "../../db/schema";
import { getDb } from "../../db/client";
import { setTxSetting, withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { NotFoundError, UnauthenticatedError } from "../../platform/errors";
import { API_SCOPES, requirePermission } from "../../platform/permissions";
import { parseOrThrow } from "../../platform/validation";

// Claves API por empresa para integraciones (p. ej. el asistente de WhatsApp). Solo lectura.
// Formato: ios_<prefijo 8>_<secreto 32>. Se guarda únicamente el SHA-256; la clave se muestra una vez.

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

const createSchema = z.object({
  name: z.string().trim().min(2, "Escribe un nombre descriptivo.").max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Selecciona al menos un permiso."),
});

export async function createApiKey(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "apikeys.manage");
  const input = parseOrThrow(createSchema, raw);
  const prefix = randomBytes(6).toString("base64url").slice(0, 8);
  const key = `ios_${prefix}_${randomBytes(24).toString("base64url")}`;
  const id = await withTenantTx(ctx, async (tx) => {
    const [row] = await tx
      .insert(apiKeys)
      .values({ organizationId: ctx.organizationId, name: input.name, prefix, keyHash: hash(key), scopes: [...new Set(input.scopes)], createdBy: ctx.userId })
      .returning({ id: apiKeys.id });
    await audit(tx, ctx, "api_key.created", { type: "api_key", id: row!.id }, { name: input.name, scopes: input.scopes });
    return row!.id;
  });
  return { id, key };
}

export async function listApiKeys(ctx: TenantContext) {
  requirePermission(ctx, "apikeys.manage");
  return withTenantTx(ctx, (tx) =>
    tx
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdByName: users.name,
      })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.createdBy))
      .orderBy(desc(apiKeys.createdAt)),
  );
}

export async function revokeApiKey(ctx: TenantContext, id: string) {
  requirePermission(ctx, "apikeys.manage");
  await withTenantTx(ctx, async (tx) => {
    const updated = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (updated.length === 0) throw new NotFoundError("Clave no encontrada o ya revocada.");
    await audit(tx, ctx, "api_key.revoked", { type: "api_key", id });
  });
}

/**
 * Resuelve una clave presentada en Authorization: Bearer. La política RLS api_key_lookup solo deja ver
 * la fila cuyo hash coincide; la empresa sale de esa fila, nunca de la solicitud.
 */
export async function authenticateApiKey(authorization: string | null): Promise<TenantContext> {
  const key = authorization?.match(/^Bearer\s+(ios_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{32})$/)?.[1];
  if (!key) throw new UnauthenticatedError("Falta una clave API válida (Authorization: Bearer ios_...).");
  const keyHash = hash(key);
  const found = await getDb().transaction(async (tx) => {
    await setTxSetting(tx, "app.api_key_hash", keyHash);
    const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash));
    return row;
  });
  if (!found || found.revokedAt) throw new UnauthenticatedError("Clave API inválida o revocada.");
  const ctx: TenantContext = {
    organizationId: found.organizationId,
    userId: found.createdBy,
    role: "viewer",
    actor: { type: "api_key", apiKeyId: found.id, scopes: found.scopes },
  };
  // Si el creador ya no es miembro activo o su cuenta está bloqueada, la clave deja de funcionar.
  await withTenantTx(ctx, async (tx) => {
    const [m] = await tx
      .select({ status: memberships.status, userActive: users.isActive })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.organizationId, found.organizationId), eq(memberships.userId, found.createdBy)));
    if (!m || m.status !== "active" || !m.userActive) throw new UnauthenticatedError("Clave API inválida o revocada.");
    await tx
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(and(eq(apiKeys.id, found.id), sql`(${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < now() - interval '1 minute')`));
  });
  return ctx;
}

export async function listAudit(ctx: TenantContext, f: { page?: number; pageSize?: number; action?: string } = {}) {
  requirePermission(ctx, "audit.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, f.pageSize ?? 50);
  return withTenantTx(ctx, async (tx) => {
    const where = f.action ? sql`${auditLogs.action} like ${`${f.action}%`}` : undefined;
    const rows = await tx
      .select({ log: auditLogs, userName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(desc(auditLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where);
    return { rows: rows.map((r) => ({ ...r.log, userName: r.userName })), total: total?.n ?? 0, page, pageSize };
  });
}
