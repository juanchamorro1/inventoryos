import "server-only";
import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { invitations, memberships, organizations, platformAdmins, platformAuditLogs, sessions, users } from "../../db/schema";
import { setTxSetting, withGlobalTx } from "../../db/tx";
import { BUSINESS_TYPES, type BusinessType } from "../../platform/business-types";
import type { TenantContext } from "../../platform/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../platform/errors";
import { parseOrThrow } from "../../platform/validation";
import { createOrganization, emailSchema, type SessionInfo } from "../auth/service";
import { insertInvitationTx } from "../invitations/service";
import { applyBusinessProfileTx } from "../organizations/service";
import { issueResetToken, platformAudit, revokeResetTokens } from "../auth/recovery";

// Funciones administrativas de PLATAFORMA (operadores de InventoryOS), separadas de los roles de empresa:
// ser propietario o administrador de una empresa no da ningún poder aquí.
//   - Quién es administrador de plataforma lo define la tabla platform_admins, que la aplicación solo puede leer;
//     se otorga y retira con `npm run platform:admin` usando el rol dueño de la base (fuera de la web).
//   - Cada operación vuelve a verificar, dentro de su transacción, que quien actúa sigue siendo administrador
//     y que su cuenta está activa, y exige una sesión iniciada hace menos de PLATFORM_SESSION_MAX_AGE_HOURS.
//   - Todo queda en platform_audit_logs (solo inserción).
// Estas funciones no leen datos de negocio de ninguna empresa.

export const PLATFORM_SESSION_MAX_AGE_HOURS = 12;

export type PlatformContext = { userId: string; ip: string | null; sessionCreatedAt: Date };

async function assertAdmin(tx: Tx, userId: string) {
  const [row] = await tx
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(and(eq(platformAdmins.userId, userId), eq(users.isActive, true)));
  // 404 y no 403: quien no es administrador no debe saber que estas funciones existen.
  if (!row) throw new NotFoundError();
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    await withGlobalTx((tx) => assertAdmin(tx, userId));
    return true;
  } catch (err) {
    if (err instanceof NotFoundError) return false;
    throw err;
  }
}

/** Verifica la autorización de plataforma a partir de la sesión. */
export async function requirePlatformAdmin(session: SessionInfo | null, ip: string | null): Promise<PlatformContext> {
  if (!session) throw new NotFoundError();
  await withGlobalTx((tx) => assertAdmin(tx, session.user.id));
  return { userId: session.user.id, ip, sessionCreatedAt: session.createdAt };
}

export const isSessionFresh = (createdAt: Date) => Date.now() - createdAt.getTime() < PLATFORM_SESSION_MAX_AGE_HOURS * 3_600_000;

/** Envuelve cada operación: revalida la autorización y la frescura de la sesión dentro de la transacción. */
function asAdmin<T>(pctx: PlatformContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withGlobalTx(async (tx) => {
    await assertAdmin(tx, pctx.userId);
    if (!isSessionFresh(pctx.sessionCreatedAt)) {
      throw new ForbiddenError(`Por seguridad, vuelve a iniciar sesión para usar las funciones de plataforma (máximo ${PLATFORM_SESSION_MAX_AGE_HOURS} horas desde el ingreso).`);
    }
    return fn(tx);
  });
}

export type PlatformUser = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  blockedAt: Date | null;
  blockedReason: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  activeSessions: number;
  isPlatformAdmin: boolean;
};

/** Busca una cuenta por correo exacto (sin listados masivos). Solo datos globales de la cuenta. */
export async function findUserByEmail(pctx: PlatformContext, rawEmail: unknown): Promise<PlatformUser | null> {
  const email = parseOrThrow(emailSchema, rawEmail, "Escribe un correo válido.");
  return asAdmin(pctx, async (tx) => {
    const [u] = await tx
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        blockedAt: users.blockedAt,
        blockedReason: users.blockedReason,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`);
    if (!u) return null;
    const [s] = await tx.select({ n: count() }).from(sessions).where(and(eq(sessions.userId, u.id), gt(sessions.expiresAt, sql`now()`)));
    const [a] = await tx.select({ n: count() }).from(platformAdmins).where(eq(platformAdmins.userId, u.id));
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.user_viewed", targetUserId: u.id, ip: pctx.ip });
    return { ...u, activeSessions: s?.n ?? 0, isPlatformAdmin: (a?.n ?? 0) > 0 };
  });
}

/** Bloquea la fila de la cuenta objetivo y valida que se pueda actuar sobre ella. */
async function lockTarget(tx: Tx, pctx: PlatformContext, userId: unknown) {
  const id = z.string().uuid().safeParse(userId);
  if (!id.success) throw new NotFoundError("Cuenta no encontrada.");
  const [u] = await tx.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, id.data)).for("update");
  if (!u) throw new NotFoundError("Cuenta no encontrada.");
  if (u.id === pctx.userId) throw new ForbiddenError("No puedes aplicar esta acción a tu propia cuenta.");
  const [admin] = await tx.select({ n: count() }).from(platformAdmins).where(eq(platformAdmins.userId, u.id));
  if ((admin?.n ?? 0) > 0) throw new ForbiddenError("Esa cuenta es administradora de plataforma: retírale el rol con el script antes de actuar sobre ella.");
  return u;
}

const reasonSchema = z.string().trim().min(3, "Indica el motivo (mínimo 3 caracteres).").max(300);

/** Bloquea la cuenta en toda la plataforma: cierra todas sus sesiones (en todas las empresas) y anula sus enlaces de recuperación. */
export async function blockUser(pctx: PlatformContext, userId: unknown, rawReason: unknown) {
  const parsed = reasonSchema.safeParse(rawReason);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]!.message, { reason: [parsed.error.issues[0]!.message] });
  await asAdmin(pctx, async (tx) => {
    const u = await lockTarget(tx, pctx, userId);
    if (!u.isActive) throw new ConflictError("La cuenta ya está bloqueada.");
    await tx.update(users).set({ isActive: false, blockedAt: sql`now()`, blockedReason: parsed.data }).where(eq(users.id, u.id));
    const closed = await tx.delete(sessions).where(eq(sessions.userId, u.id)).returning({ t: sessions.tokenHash });
    await revokeResetTokens(tx, u.id);
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.user_blocked", targetUserId: u.id, data: { reason: parsed.data, sessionsClosed: closed.length }, ip: pctx.ip });
  });
}

export async function unblockUser(pctx: PlatformContext, userId: unknown) {
  await asAdmin(pctx, async (tx) => {
    const u = await lockTarget(tx, pctx, userId);
    if (u.isActive) throw new ConflictError("La cuenta no está bloqueada.");
    await tx.update(users).set({ isActive: true, blockedAt: null, blockedReason: null }).where(eq(users.id, u.id));
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.user_unblocked", targetUserId: u.id, ip: pctx.ip });
  });
}

/** Cierra todas las sesiones de una cuenta (p. ej. si reporta un dispositivo perdido). */
export async function revokeUserSessions(pctx: PlatformContext, userId: unknown): Promise<number> {
  return asAdmin(pctx, async (tx) => {
    const u = await lockTarget(tx, pctx, userId);
    const closed = await tx.delete(sessions).where(eq(sessions.userId, u.id)).returning({ t: sessions.tokenHash });
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.sessions_revoked", targetUserId: u.id, data: { count: closed.length }, ip: pctx.ip });
    return closed.length;
  });
}

/**
 * Genera un enlace de recuperación para entregarlo por un canal verificado (sin proveedor de correo).
 * El administrador no ve ni elige la contraseña: la persona la define al abrir el enlace.
 */
export async function issuePasswordResetLink(pctx: PlatformContext, userId: unknown): Promise<{ token: string; expiresAt: Date }> {
  return asAdmin(pctx, async (tx) => {
    const u = await lockTarget(tx, pctx, userId);
    if (!u.isActive) throw new ConflictError("La cuenta está bloqueada: desbloquéala antes de generar un enlace.");
    const issued = await issueResetToken(tx, u.id, "platform");
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.password_reset_link_issued", targetUserId: u.id, ip: pctx.ip });
    return issued;
  });
}

/** Historial reciente de seguridad de una cuenta. */
export async function listAccountEvents(pctx: PlatformContext, userId: string, limit = 20) {
  return asAdmin(pctx, (tx) =>
    tx
      .select({ id: platformAuditLogs.id, action: platformAuditLogs.action, createdAt: platformAuditLogs.createdAt, actorName: users.name, data: platformAuditLogs.data })
      .from(platformAuditLogs)
      .leftJoin(users, eq(users.id, platformAuditLogs.actorUserId))
      .where(eq(platformAuditLogs.targetUserId, userId))
      .orderBy(desc(platformAuditLogs.id))
      .limit(Math.min(limit, 100)),
  );
}

// ---------- Empresas creadas desde la plataforma ----------

const companySchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre de la empresa.").max(120),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Moneda inválida (código ISO, p. ej. COP).")
    .default("COP"),
  businessType: z.enum(BUSINESS_TYPES, { message: "Elige el tipo de negocio." }),
  ownerEmail: emailSchema,
});

export type PlatformCompany = {
  organizationId: string;
  name: string;
  businessType: BusinessType;
  ownerEmail: string;
  createdAt: Date;
  members: number;
  ownerPending: boolean;
};

/**
 * Crea una empresa nueva con la configuración de su tipo de negocio y emite la invitación del dueño.
 * La plataforma no queda como miembro: el dueño administra su empresa desde que acepta el enlace.
 */
export async function createCompany(pctx: PlatformContext, raw: unknown): Promise<{ organizationId: string; token: string; expiresAt: Date }> {
  const input = parseOrThrow(companySchema, raw);
  return asAdmin(pctx, async (tx) => {
    const organizationId = await createOrganization(tx, { userId: pctx.userId, name: input.name, currency: input.currency, businessType: input.businessType, ownerMembership: false });
    // createOrganization deja fijado app.org_id con la empresa nueva: lo que sigue ocurre dentro de esa empresa.
    const ctx: TenantContext = { organizationId, userId: pctx.userId, role: "owner", actor: { type: "user" } };
    await applyBusinessProfileTx(tx, ctx, input.businessType, { pricing: true });
    const invitation = await insertInvitationTx(tx, { organizationId, email: input.ownerEmail, role: "owner", invitedBy: pctx.userId, platformIssued: true });
    await platformAudit(tx, {
      actorUserId: pctx.userId,
      action: "platform.organization_created",
      targetUserId: null,
      data: { organizationId, name: input.name, businessType: input.businessType, ownerEmail: input.ownerEmail, currency: input.currency },
      ip: pctx.ip,
    });
    return { organizationId, token: invitation.token, expiresAt: invitation.expiresAt };
  });
}

/** Empresas creadas desde la plataforma, con su estado (miembros y si el dueño aún no aceptó). */
export async function listCompanies(pctx: PlatformContext, limit = 50): Promise<PlatformCompany[]> {
  return asAdmin(pctx, async (tx) => {
    const logs = await tx
      .select({ data: platformAuditLogs.data, createdAt: platformAuditLogs.createdAt })
      .from(platformAuditLogs)
      .where(eq(platformAuditLogs.action, "platform.organization_created"))
      .orderBy(desc(platformAuditLogs.id))
      .limit(Math.min(limit, 200));
    const out: PlatformCompany[] = [];
    for (const l of logs) {
      const d = l.data as { organizationId: string; name: string; businessType: BusinessType; ownerEmail: string };
      // Solo se consultan conteos de ESA empresa (contexto fijado por fila); no se leen datos de negocio.
      await setTxSetting(tx, "app.org_id", d.organizationId);
      const [org] = await tx.select({ name: organizations.name, businessType: organizations.businessType }).from(organizations).where(eq(organizations.id, d.organizationId));
      if (!org) continue;
      const [m] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.organizationId, d.organizationId));
      const [pending] = await tx
        .select({ n: count() })
        .from(invitations)
        .where(and(eq(invitations.organizationId, d.organizationId), eq(invitations.platformIssued, true), eq(invitations.status, "pending"), gt(invitations.expiresAt, sql`now()`)));
      out.push({ organizationId: d.organizationId, name: org.name, businessType: org.businessType as BusinessType, ownerEmail: d.ownerEmail, createdAt: l.createdAt, members: m?.n ?? 0, ownerPending: (pending?.n ?? 0) > 0 });
    }
    return out;
  });
}

/** Nuevo enlace para el dueño de una empresa creada desde la plataforma (anula el anterior). */
export async function reissueOwnerInvitation(pctx: PlatformContext, organizationId: unknown): Promise<{ token: string; email: string }> {
  const id = z.string().uuid().safeParse(organizationId);
  if (!id.success) throw new NotFoundError("Empresa no encontrada.");
  return asAdmin(pctx, async (tx) => {
    const [log] = await tx
      .select({ data: platformAuditLogs.data })
      .from(platformAuditLogs)
      .where(and(eq(platformAuditLogs.action, "platform.organization_created"), sql`${platformAuditLogs.data} ->> 'organizationId' = ${id.data}`))
      .limit(1);
    if (!log) throw new NotFoundError("Solo se pueden reenviar invitaciones de empresas creadas desde la plataforma.");
    const email = (log.data as { ownerEmail: string }).ownerEmail;
    await setTxSetting(tx, "app.org_id", id.data);
    const [owners] = await tx.select({ n: count() }).from(memberships).where(and(eq(memberships.organizationId, id.data), eq(memberships.role, "owner")));
    if ((owners?.n ?? 0) > 0) throw new ConflictError("La empresa ya tiene propietario: él puede invitar a su equipo desde Configuración › Usuarios.");
    const { token } = await insertInvitationTx(tx, { organizationId: id.data, email, role: "owner", invitedBy: pctx.userId, platformIssued: true });
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.owner_invitation_reissued", targetUserId: null, data: { organizationId: id.data, ownerEmail: email }, ip: pctx.ip });
    return { token, email };
  });
}
