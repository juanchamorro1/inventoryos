import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { memberships, organizations, users, ROLES, type Role } from "../../db/schema";
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
