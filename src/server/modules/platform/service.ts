import "server-only";
import { and, count, desc, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { apiKeys, invitations, memberships, organizations, platformAdmins, platformAuditLogs, products, productVariants, sales, sessions, users } from "../../db/schema";
import { setTxSetting, withGlobalTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import { BUSINESS_TYPES, type BusinessType } from "../../platform/business-types";
import type { TenantContext } from "../../platform/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../platform/errors";
import { PLANS, type PlanId } from "../../platform/plans";
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
// Estas funciones no leen datos de negocio de ninguna empresa. La única excepción es openCompanySupport, que entrega
// un contexto de SOLO LECTURA para el soporte y deja cada consulta en la auditoría.

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

// ---------- Todas las empresas y acceso de soporte ----------

export type PlatformCompanyRow = {
  organizationId: string;
  name: string;
  businessType: BusinessType;
  plan: string;
  isDemo: boolean;
  createdAt: Date;
  ownerEmail: string | null;
  members: number;
  products: number;
  variants: number;
  sales30d: number;
  lastLoginAt: Date | null;
  ownerPending: boolean;
  /** Miembros activos además de quien consulta: si hay, eliminar la empresa exige más confirmación. */
  otherMembers: number;
  archivedAt: Date | null;
  /** Relación de quien consulta con la empresa. */
  access: "none" | "member" | "support";
};

async function otherActiveMembers(tx: Tx, organizationId: string, userId: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active"), eq(memberships.isSupport, false), ne(memberships.userId, userId)));
  return row?.n ?? 0;
}

/** Todas las empresas de la plataforma, solo con conteos y fechas (no lee productos, precios ni montos de venta). */
export async function listAllCompanies(pctx: PlatformContext, limit = 500): Promise<PlatformCompanyRow[]> {
  return asAdmin(pctx, async (tx) => {
    // Variable propia de la política org_platform_admin_read: vale solo en esta transacción.
    await setTxSetting(tx, "app.platform_user_id", pctx.userId);
    const orgs = await tx
      .select({ id: organizations.id, name: organizations.name, businessType: organizations.businessType, plan: organizations.plan, isDemo: organizations.isDemo, createdAt: organizations.createdAt, archivedAt: organizations.archivedAt })
      .from(organizations)
      .orderBy(desc(organizations.createdAt))
      .limit(Math.min(limit, 1000));
    const out: PlatformCompanyRow[] = [];
    for (const o of orgs) {
      await setTxSetting(tx, "app.org_id", o.id);
      // El acceso de soporte no cuenta como usuario ni como actividad de la empresa.
      const [m] = await tx.select({ n: count() }).from(memberships).where(and(eq(memberships.organizationId, o.id), eq(memberships.isSupport, false)));
      const [mine] = await tx.select({ isSupport: memberships.isSupport }).from(memberships).where(and(eq(memberships.organizationId, o.id), eq(memberships.userId, pctx.userId)));
      const [p] = await tx.select({ n: count() }).from(products).where(eq(products.organizationId, o.id));
      const [v] = await tx.select({ n: count() }).from(productVariants).where(eq(productVariants.organizationId, o.id));
      const [s] = await tx
        .select({ n: count() })
        .from(sales)
        .where(and(eq(sales.organizationId, o.id), sql`${sales.status} <> 'cancelled'`, gt(sales.createdAt, sql`now() - interval '30 days'`)));
      // También las sesiones: quien entra aceptando una invitación tiene sesión pero no «último ingreso».
      const { rows: [login] } = await tx.execute<{ at: string | Date | null }>(sql`
        select greatest(
          (select max(u.last_login_at) from memberships m join users u on u.id = m.user_id where m.organization_id = ${o.id} and not m.is_support),
          (select max(se.created_at) from memberships m join sessions se on se.user_id = m.user_id where m.organization_id = ${o.id} and not m.is_support)
        ) as at`);
      const [owner] = await tx
        .select({ email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.organizationId, o.id), eq(memberships.role, "owner")))
        .limit(1);
      const [pending] = await tx
        .select({ email: invitations.email })
        .from(invitations)
        .where(and(eq(invitations.organizationId, o.id), eq(invitations.platformIssued, true), eq(invitations.status, "pending"), gt(invitations.expiresAt, sql`now()`)))
        .limit(1);
      out.push({
        organizationId: o.id,
        name: o.name,
        businessType: o.businessType as BusinessType,
        plan: o.plan,
        isDemo: o.isDemo,
        createdAt: o.createdAt,
        ownerEmail: owner?.email ?? pending?.email ?? null,
        members: m?.n ?? 0,
        products: p?.n ?? 0,
        variants: v?.n ?? 0,
        sales30d: s?.n ?? 0,
        lastLoginAt: login?.at ? new Date(login.at) : null,
        ownerPending: !!pending,
        otherMembers: await otherActiveMembers(tx, o.id, pctx.userId),
        archivedAt: o.archivedAt,
        access: !mine ? "none" : mine.isSupport ? "support" : "member",
      });
    }
    return out;
  });
}

/** Cambia el plan comercial de una empresa (no hay cobros integrados). Bajar de plan no borra datos. */
export async function setCompanyPlan(pctx: PlatformContext, organizationId: unknown, rawPlan: unknown) {
  const id = z.string().uuid().safeParse(organizationId);
  if (!id.success) throw new NotFoundError("Empresa no encontrada.");
  const plan = z.enum(Object.keys(PLANS) as [PlanId, ...PlanId[]]).safeParse(rawPlan);
  if (!plan.success) throw new ValidationError("Plan inválido.");
  await asAdmin(pctx, async (tx) => {
    await setTxSetting(tx, "app.org_id", id.data);
    const [org] = await tx.select({ name: organizations.name, plan: organizations.plan }).from(organizations).where(eq(organizations.id, id.data)).for("update");
    if (!org) throw new NotFoundError("Empresa no encontrada.");
    if (org.plan === plan.data) return;
    await tx.update(organizations).set({ plan: plan.data }).where(eq(organizations.id, id.data));
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.plan_changed", targetUserId: null, data: { organizationId: id.data, name: org.name, from: org.plan, to: plan.data }, ip: pctx.ip });
  });
}

/**
 * Elimina una empresa: nadie vuelve a entrar y sus claves API e invitaciones dejan de servir. Los datos se conservan
 * y se puede restaurar: stock_documents, stock_movements y audit_logs son de solo inserción, ni el dueño del esquema
 * puede borrarlos. Si la empresa tiene otros miembros, además hay que escribir su nombre y un motivo; lo decide aquí
 * el servidor, con el conteo de esta transacción, no el formulario.
 */
export async function archiveCompany(pctx: PlatformContext, organizationId: unknown, confirm: { confirmName?: unknown; reason?: unknown } = {}) {
  const id = z.string().uuid().safeParse(organizationId);
  if (!id.success) throw new NotFoundError("Empresa no encontrada.");
  await asAdmin(pctx, async (tx) => {
    await setTxSetting(tx, "app.org_id", id.data);
    const [org] = await tx.select({ name: organizations.name, archivedAt: organizations.archivedAt }).from(organizations).where(eq(organizations.id, id.data)).for("update");
    if (!org) throw new NotFoundError("Empresa no encontrada.");
    if (org.archivedAt) throw new ConflictError("Esta empresa ya está eliminada.");
    const others = await otherActiveMembers(tx, id.data, pctx.userId);
    let reason: string | null = null;
    if (others > 0) {
      if (String(confirm.confirmName ?? "").trim() !== org.name) {
        throw new ValidationError(`Esta empresa tiene ${others} usuario(s) más: escribe su nombre exacto para confirmar.`, { confirmName: ["Escribe el nombre exacto de la empresa."] });
      }
      const parsed = reasonSchema.safeParse(confirm.reason);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]!.message, { reason: [parsed.error.issues[0]!.message] });
      reason = parsed.data;
    }
    await tx.update(organizations).set({ archivedAt: sql`now()` }).where(eq(organizations.id, id.data));
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.company_archived", targetUserId: null, data: { organizationId: id.data, name: org.name, otherMembers: others, reason }, ip: pctx.ip });
  });
}

/** Devuelve el acceso a una empresa eliminada, con todos sus datos. */
export async function restoreCompany(pctx: PlatformContext, organizationId: unknown) {
  const id = z.string().uuid().safeParse(organizationId);
  if (!id.success) throw new NotFoundError("Empresa no encontrada.");
  await asAdmin(pctx, async (tx) => {
    await setTxSetting(tx, "app.org_id", id.data);
    const [org] = await tx.select({ name: organizations.name, archivedAt: organizations.archivedAt }).from(organizations).where(eq(organizations.id, id.data)).for("update");
    if (!org) throw new NotFoundError("Empresa no encontrada.");
    if (!org.archivedAt) throw new ConflictError("Esta empresa no está eliminada.");
    await tx.update(organizations).set({ archivedAt: null }).where(eq(organizations.id, id.data));
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.company_restored", targetUserId: null, data: { organizationId: id.data, name: org.name }, ip: pctx.ip });
  });
}

/**
 * «Entrar a ayudar»: une al administrador a la empresa como administrador de la empresa, para montarle la cuenta.
 * Exige un motivo, queda en las dos auditorías y el cliente lo ve en su lista de usuarios, donde puede desactivarlo:
 * si lo hizo, se respeta y no se puede volver a entrar por aquí. Nunca convierte una membresía real en soporte.
 */
export async function joinCompanySupport(pctx: PlatformContext, organizationId: unknown, rawReason: unknown) {
  const id = z.string().uuid().safeParse(organizationId);
  if (!id.success) throw new NotFoundError("Empresa no encontrada.");
  const reason = reasonSchema.safeParse(rawReason);
  if (!reason.success) throw new ValidationError(reason.error.issues[0]!.message, { reason: [reason.error.issues[0]!.message] });
  await asAdmin(pctx, async (tx) => {
    await setTxSetting(tx, "app.org_id", id.data);
    await setTxSetting(tx, "app.user_id", pctx.userId);
    const [org] = await tx.select({ name: organizations.name, archivedAt: organizations.archivedAt }).from(organizations).where(eq(organizations.id, id.data)).for("update");
    if (!org) throw new NotFoundError("Empresa no encontrada.");
    if (org.archivedAt) throw new ConflictError("Esta empresa está eliminada: restáurala antes de entrar.");
    const [mine] = await tx.select({ status: memberships.status, isSupport: memberships.isSupport }).from(memberships).where(and(eq(memberships.organizationId, id.data), eq(memberships.userId, pctx.userId)));
    if (mine && !mine.isSupport) throw new ConflictError("Ya eres miembro de esta empresa: entra desde «Cambiar empresa».");
    if (mine?.status === "disabled") throw new ForbiddenError("Esta empresa desactivó tu acceso de soporte: pídele que lo reactive.");
    if (!mine) await tx.insert(memberships).values({ organizationId: id.data, userId: pctx.userId, role: "admin", isSupport: true });
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.company_support_joined", targetUserId: null, data: { organizationId: id.data, name: org.name, reason: reason.data }, ip: pctx.ip });
    const ctx: TenantContext = { organizationId: id.data, userId: pctx.userId, role: "admin", actor: { type: "user" }, supportAccess: true };
    await audit(tx, ctx, "support.joined", { type: "user", id: pctx.userId }, { reason: reason.data });
  });
}

/**
 * Sale de una empresa donde se entró a ayudar. Las claves API y las invitaciones dependen de que quien las creó siga
 * activo: si quedaran, salir apagaría la tienda del cliente sin aviso, así que primero hay que resolverlas.
 */
export async function leaveCompanySupport(pctx: PlatformContext, organizationId: unknown) {
  const id = z.string().uuid().safeParse(organizationId);
  if (!id.success) throw new NotFoundError("Empresa no encontrada.");
  await asAdmin(pctx, async (tx) => {
    await setTxSetting(tx, "app.org_id", id.data);
    await setTxSetting(tx, "app.user_id", pctx.userId);
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, id.data)).for("update");
    if (!org) throw new NotFoundError("Empresa no encontrada.");
    const [mine] = await tx.select({ isSupport: memberships.isSupport }).from(memberships).where(and(eq(memberships.organizationId, id.data), eq(memberships.userId, pctx.userId)));
    if (!mine?.isSupport) throw new NotFoundError("No tienes acceso de soporte en esta empresa.");
    const [keys] = await tx.select({ n: count() }).from(apiKeys).where(and(eq(apiKeys.organizationId, id.data), eq(apiKeys.createdBy, pctx.userId), sql`${apiKeys.revokedAt} is null`));
    const [pending] = await tx
      .select({ n: count() })
      .from(invitations)
      .where(and(eq(invitations.organizationId, id.data), eq(invitations.invitedBy, pctx.userId), eq(invitations.status, "pending"), gt(invitations.expiresAt, sql`now()`)));
    if ((keys?.n ?? 0) > 0 || (pending?.n ?? 0) > 0) {
      throw new ConflictError(
        `Antes de salir: creaste ${keys?.n ?? 0} clave(s) API y ${pending?.n ?? 0} invitación(es) pendiente(s), que dejarían de funcionar y podrían apagar su tienda. Pide al dueño que cree sus claves y que el equipo acepte, o anúlalas.`,
      );
    }
    const ctx: TenantContext = { organizationId: id.data, userId: pctx.userId, role: "admin", actor: { type: "user" }, supportAccess: true };
    await audit(tx, ctx, "support.left", { type: "user", id: pctx.userId });
    await tx.delete(memberships).where(and(eq(memberships.organizationId, id.data), eq(memberships.userId, pctx.userId)));
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.company_support_left", targetUserId: null, data: { organizationId: id.data, name: org.name }, ip: pctx.ip });
  });
}

export const SUPPORT_VIEWS = ["products", "stock", "sales"] as const;
export type SupportView = (typeof SUPPORT_VIEWS)[number];

/**
 * Abre una empresa en modo soporte: revalida al administrador, registra la consulta y entrega un contexto con rol
 * "viewer". Ese rol no tiene ningún permiso de escritura, así que requirePermission rechaza cualquier cambio, y RLS
 * sigue limitando cada consulta a esta empresa. El administrador no queda como miembro.
 */
export async function openCompanySupport(pctx: PlatformContext, organizationId: unknown, view: SupportView) {
  const id = z.string().uuid().safeParse(organizationId);
  if (!id.success) throw new NotFoundError("Empresa no encontrada.");
  return asAdmin(pctx, async (tx) => {
    await setTxSetting(tx, "app.org_id", id.data);
    const [company] = await tx
      .select({ id: organizations.id, name: organizations.name, currency: organizations.currency, timezone: organizations.timezone, plan: organizations.plan })
      .from(organizations)
      .where(eq(organizations.id, id.data));
    if (!company) throw new NotFoundError("Empresa no encontrada.");
    await platformAudit(tx, { actorUserId: pctx.userId, action: "platform.company_viewed", targetUserId: null, data: { organizationId: company.id, name: company.name, view }, ip: pctx.ip });
    const ctx: TenantContext = { organizationId: company.id, userId: pctx.userId, role: "viewer", actor: { type: "user" } };
    return { ctx, company };
  });
}

/** Últimas consultas de soporte a una empresa (quién y cuándo). */
export async function listCompanyAccess(pctx: PlatformContext, organizationId: string, limit = 10) {
  return asAdmin(pctx, (tx) =>
    tx
      .select({ id: platformAuditLogs.id, createdAt: platformAuditLogs.createdAt, actorName: users.name, data: platformAuditLogs.data })
      .from(platformAuditLogs)
      .leftJoin(users, eq(users.id, platformAuditLogs.actorUserId))
      .where(and(eq(platformAuditLogs.action, "platform.company_viewed"), sql`${platformAuditLogs.data} ->> 'organizationId' = ${organizationId}`))
      .orderBy(desc(platformAuditLogs.id))
      .limit(Math.min(limit, 50)),
  );
}
