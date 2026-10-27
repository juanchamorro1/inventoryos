import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { categories, memberships, organizations, pricingSettings, users, ROLES, type Role } from "../../db/schema";
import { BUSINESS_TYPES, profileOf, type BusinessType } from "../../platform/business-types";
import { withGlobalTx, withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../platform/errors";
import { canAssignRole, requirePermission } from "../../platform/permissions";
import { PLANS, type PlanId } from "../../platform/plans";

export async function getOrganization(ctx: TenantContext) {
  const [org] = await withTenantTx(ctx, (tx) => tx.select().from(organizations).where(eq(organizations.id, ctx.organizationId)));
  if (!org) throw new NotFoundError();
  return { ...org, planInfo: PLANS[org.plan as PlanId] };
}

/**
 * Aplica la configuración recomendada de un tipo de negocio: crea las categorías que falten y, si `pricing`,
 * ajusta los sistemas de precios. Nunca borra ni renombra nada.
 */
export async function applyBusinessProfileTx(tx: Tx, ctx: TenantContext, type: BusinessType, opts: { pricing: boolean }) {
  const profile = profileOf(type);
  const existing = new Set((await tx.select({ name: categories.name }).from(categories)).map((c) => c.name.toLowerCase()));
  const missing = profile.categories.filter((c) => !existing.has(c.toLowerCase()));
  if (missing.length) await tx.insert(categories).values(missing.map((name) => ({ organizationId: ctx.organizationId, name })));
  if (opts.pricing) {
    await tx
      .insert(pricingSettings)
      .values({ organizationId: ctx.organizationId, ...profile.pricing, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: pricingSettings.organizationId, set: { ...profile.pricing, updatedAt: new Date(), updatedBy: ctx.userId } });
  }
  return { categoriesCreated: missing.length };
}

/** Cambia el tipo de negocio y aplica su configuración recomendada (categorías y, si se pide, sistemas de precios). */
export async function setBusinessType(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const parsed = z.object({ businessType: z.enum(BUSINESS_TYPES), applyPricing: z.boolean().default(false) }).safeParse(raw);
  if (!parsed.success) throw new ValidationError("Elige un tipo de negocio.", { businessType: ["Elige un tipo de negocio."] });
  if (parsed.data.applyPricing) requirePermission(ctx, "pricing.manage");
  return withTenantTx(ctx, async (tx) => {
    await tx.update(organizations).set({ businessType: parsed.data.businessType }).where(eq(organizations.id, ctx.organizationId));
    const result = await applyBusinessProfileTx(tx, ctx, parsed.data.businessType, { pricing: parsed.data.applyPricing });
    await audit(tx, ctx, "organization.business_type", { type: "organization", id: ctx.organizationId }, { ...parsed.data, ...result });
    return result;
  });
}

export const organizationSettingsSchema = z.object({
  name: z.string().trim().min(2, "Nombre demasiado corto.").max(120),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Código ISO de 3 letras."),
  timezone: z.string().trim().min(3).max(64),
  lowStockAlerts: z.boolean().default(true),
});

export async function updateOrganization(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const parsed = organizationSettingsSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Revisa los datos.", z.flattenError(parsed.error).fieldErrors);
  try {
    Intl.DateTimeFormat("es", { timeZone: parsed.data.timezone });
  } catch {
    throw new ValidationError("Zona horaria inválida.", { timezone: ["Usa un identificador IANA, p. ej. America/Bogota."] });
  }
  await withTenantTx(ctx, async (tx) => {
    await tx
      .update(organizations)
      .set({
        name: parsed.data.name,
        currency: parsed.data.currency,
        timezone: parsed.data.timezone,
        settings: { lowStockAlerts: parsed.data.lowStockAlerts },
      })
      .where(eq(organizations.id, ctx.organizationId));
    await audit(tx, ctx, "organization.updated", { type: "organization", id: ctx.organizationId }, parsed.data);
  });
}

export async function listMembers(ctx: TenantContext) {
  requirePermission(ctx, "members.manage");
  return withTenantTx(ctx, async (tx) => {
    const rows = await tx
      .select({ userId: memberships.userId, role: memberships.role, status: memberships.status, createdAt: memberships.createdAt })
      .from(memberships)
      .where(eq(memberships.organizationId, ctx.organizationId));
    if (rows.length === 0) return [];
    // users es una tabla global: solo se consultan los usuarios que ya son miembros de esta empresa.
    const people = await tx
      .select({ id: users.id, name: users.name, email: users.email, lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(sql`${users.id} in ${rows.map((r) => r.userId)}`)
      .orderBy(asc(users.name));
    return people.map((p) => ({ ...p, ...rows.find((r) => r.userId === p.id)! }));
  });
}

export async function updateMember(ctx: TenantContext, userId: string, raw: unknown) {
  requirePermission(ctx, "members.manage");
  const parsed = z.object({ role: z.enum(ROLES), status: z.enum(["active", "disabled"]) }).safeParse(raw);
  if (!parsed.success) throw new ValidationError("Datos inválidos.", z.flattenError(parsed.error).fieldErrors);
  if (userId === ctx.userId) throw new ForbiddenError("No puedes cambiar tu propio rol o estado.");
  await withTenantTx(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, userId)))
      .for("update");
    if (!current) throw new NotFoundError();
    if (!canAssignRole(ctx.role, current.role as Role) || !canAssignRole(ctx.role, parsed.data.role)) {
      throw new ForbiddenError("No puedes modificar a un miembro con un rol superior al tuyo.");
    }
    if (current.role === "owner" && (parsed.data.role !== "owner" || parsed.data.status !== "active")) {
      const [owners] = await tx
        .select({ n: count() })
        .from(memberships)
        .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.role, "owner"), eq(memberships.status, "active")));
      if ((owners?.n ?? 0) <= 1) throw new ConflictError("La empresa debe conservar al menos un propietario activo.");
    }
    await tx
      .update(memberships)
      .set(parsed.data)
      .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, userId)));
    await audit(tx, ctx, "member.updated", { type: "user", id: userId }, parsed.data);
  });
  if (parsed.data.status === "disabled") {
    // Cierra las sesiones que tengan activa esta empresa.
    await withGlobalTx((tx) =>
      tx.execute(sql`update sessions set active_organization_id = null where user_id = ${userId} and active_organization_id = ${ctx.organizationId}`),
    );
  }
}
