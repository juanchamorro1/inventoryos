import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { getDb } from "../../db/client";
import { invitations, memberships, organizations, ROLES, users, type Role } from "../../db/schema";
import { setTxSetting, withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError, ValidationError } from "../../platform/errors";
import { canAssignRole, requirePermission } from "../../platform/permissions";
import { assertWithinPlan } from "../../platform/plans";
import { parseOrThrow } from "../../platform/validation";
import { hashPassword, passwordProblem } from "../auth/password";
import { emailSchema } from "../auth/service";

// Invitaciones a una empresa. Reemplazan el alta directa de miembros:
//   - Ninguna empresa crea cuentas con contraseña ni modifica cuentas existentes.
//   - Nadie queda vinculado a una empresa sin aceptar explícitamente con su propia cuenta.
// El token (32 bytes aleatorios) solo viaja en el enlace; en la base se guarda su SHA-256.

export const INVITATION_TTL_HOURS = 72;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const INVALID = "Esta invitación no existe o el enlace está incompleto. Pide a la empresa que te envíe una nueva.";

const createSchema = z.object({ email: emailSchema, role: z.enum(ROLES) });

/** Bloquea la fila de la empresa para serializar las verificaciones de límite de usuarios del plan. */
async function lockOrganization(tx: Tx, organizationId: string) {
  await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).for("update");
}

export async function createInvitation(ctx: TenantContext, raw: unknown): Promise<{ id: string; token: string; expiresAt: Date }> {
  requirePermission(ctx, "members.manage");
  const { email, role } = parseOrThrow(createSchema, raw);
  if (!canAssignRole(ctx.role, role)) throw new ForbiddenError("No puedes invitar con un rol superior al tuyo.");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3_600_000);
  try {
    return await withTenantTx(ctx, async (tx) => {
      await lockOrganization(tx, ctx.organizationId);
      // Solo se consulta si el correo ya es miembro de ESTA empresa (no revela cuentas de otras empresas).
      const [member] = await tx
        .select({ status: memberships.status })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.organizationId, ctx.organizationId), sql`lower(${users.email}) = ${email}`));
      if (member) {
        throw new ConflictError(
          member.status === "active"
            ? "Esa persona ya es miembro de la empresa."
            : "Esa persona ya es miembro de la empresa, pero está desactivada: reactívala en la lista de usuarios.",
        );
      }
      // Una invitación nueva al mismo correo reemplaza a la anterior (p. ej. si se perdió el enlace).
      const replaced = await tx
        .update(invitations)
        .set({ status: "revoked", revokedAt: sql`now()` })
        .where(and(eq(invitations.organizationId, ctx.organizationId), eq(invitations.email, email), eq(invitations.status, "pending")))
        .returning({ id: invitations.id });
      await assertWithinPlan(tx, ctx.organizationId, "users");
      const [row] = await tx
        .insert(invitations)
        .values({ organizationId: ctx.organizationId, email, role, tokenHash: hashToken(token), invitedBy: ctx.userId, expiresAt })
        .returning({ id: invitations.id });
      await audit(tx, ctx, "invitation.created", { type: "invitation", id: row!.id }, { email, role, replaced: replaced.map((r) => r.id) });
      return { id: row!.id, token, expiresAt };
    });
  } catch (err) {
    // Dos invitaciones simultáneas al mismo correo: el índice único deja pasar solo una.
    if (isUniqueViolation(err, "invitations_pending_email_uq")) throw new ConflictError("Ya se está creando una invitación para ese correo. Recarga la página.");
    throw err;
  }
}

export async function listInvitations(ctx: TenantContext) {
  requirePermission(ctx, "members.manage");
  return withTenantTx(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
        invitedByName: users.name,
        expired: sql<boolean>`${invitations.expiresAt} <= now()`,
      })
      .from(invitations)
      .innerJoin(users, eq(users.id, invitations.invitedBy))
      .where(and(eq(invitations.organizationId, ctx.organizationId), eq(invitations.status, "pending")))
      .orderBy(desc(invitations.createdAt));
    return rows;
  });
}

export async function revokeInvitation(ctx: TenantContext, id: string) {
  requirePermission(ctx, "members.manage");
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Invitación no encontrada.");
  await withTenantTx(ctx, async (tx) => {
    const [inv] = await tx
      .select({ role: invitations.role })
      .from(invitations)
      .where(and(eq(invitations.id, id), eq(invitations.organizationId, ctx.organizationId), eq(invitations.status, "pending")))
      .for("update");
    if (!inv) throw new NotFoundError("Invitación no encontrada o ya no está pendiente.");
    if (!canAssignRole(ctx.role, inv.role)) throw new ForbiddenError("No puedes anular una invitación con un rol superior al tuyo.");
    await tx.update(invitations).set({ status: "revoked", revokedAt: sql`now()` }).where(eq(invitations.id, id));
    await audit(tx, ctx, "invitation.revoked", { type: "invitation", id });
  });
}

type Invitation = typeof invitations.$inferSelect;

/**
 * Transacción que resuelve la invitación a partir del token: la política RLS invitation_token_lookup solo
 * deja ver la fila cuyo hash coincide. Después fija la empresa de ESA fila (nunca una que venga de la solicitud).
 */
async function withInvitation<T>(token: string, fn: (tx: Tx, inv: Invitation) => Promise<T>): Promise<T> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) throw new NotFoundError(INVALID);
  const tokenHash = hashToken(token);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '30s', true)`);
    await setTxSetting(tx, "app.invite_token_hash", tokenHash);
    const [inv] = await tx.select().from(invitations).where(eq(invitations.tokenHash, tokenHash));
    if (!inv) throw new NotFoundError(INVALID);
    await setTxSetting(tx, "app.org_id", inv.organizationId);
    return fn(tx, inv);
  });
}

export type InvitationView = {
  organizationName: string;
  email: string;
  role: Role;
  state: "valid" | "expired" | "accepted" | "revoked";
  accountExists: boolean;
};

/** Datos que ve quien abre el enlace. Solo el portador del token llega aquí. */
export async function getInvitationByToken(token: string): Promise<InvitationView> {
  return withInvitation(token, async (tx, inv) => {
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, inv.organizationId));
    const [account] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${inv.email}`);
    const state = inv.status !== "pending" ? inv.status : inv.expiresAt <= new Date() ? "expired" : "valid";
    return { organizationName: org?.name ?? "", email: inv.email, role: inv.role, state, accountExists: Boolean(account) };
  });
}

/**
 * Reserva la invitación de forma atómica: el UPDATE condicionado a status='pending' y no vencida bloquea la fila,
 * así que de dos aceptaciones simultáneas solo una obtiene la fila; la otra la ve ya aceptada y falla.
 */
async function claim(tx: Tx, inv: Invitation) {
  const [claimed] = await tx
    .update(invitations)
    .set({ status: "accepted", acceptedAt: sql`now()` })
    .where(and(eq(invitations.id, inv.id), eq(invitations.status, "pending"), gt(invitations.expiresAt, sql`now()`)))
    .returning({ id: invitations.id });
  if (claimed) return;
  const [current] = await tx.select({ status: invitations.status }).from(invitations).where(eq(invitations.id, inv.id));
  if (current?.status === "accepted") throw new ConflictError("Esta invitación ya fue usada.", "invitation_used");
  if (current?.status === "revoked") throw new ConflictError("Esta invitación fue anulada por la empresa.", "invitation_revoked");
  throw new ConflictError("Esta invitación venció. Pide a la empresa que te envíe una nueva.", "invitation_expired");
}

/** Une a la persona a la empresa con la invitación ya reservada en esta transacción. */
async function join(tx: Tx, inv: Invitation, userId: string) {
  // Quien invitó debe seguir activo (en la empresa y en la plataforma) y poder asignar ese rol; si no, la invitación pierde validez.
  const [inviter] = await tx
    .select({ role: memberships.role, status: memberships.status, userActive: users.isActive })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, inv.organizationId), eq(memberships.userId, inv.invitedBy)));
  if (!inviter || inviter.status !== "active" || !inviter.userActive || !canAssignRole(inviter.role, inv.role)) {
    throw new ConflictError("Esta invitación ya no es válida. Pide a la empresa que te envíe una nueva.", "invitation_revoked");
  }
  await lockOrganization(tx, inv.organizationId);
  await assertWithinPlan(tx, inv.organizationId, "users");
  try {
    await tx.insert(memberships).values({ organizationId: inv.organizationId, userId, role: inv.role });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("Ya eres miembro de esta empresa.", "already_member");
    throw err;
  }
  await tx.update(invitations).set({ acceptedBy: userId }).where(eq(invitations.id, inv.id));
  const ctx: TenantContext = { organizationId: inv.organizationId, userId, role: inv.role, actor: { type: "user" } };
  await audit(tx, ctx, "invitation.accepted", { type: "invitation", id: inv.id }, { email: inv.email, role: inv.role });
  await audit(tx, ctx, "member.added", { type: "user", id: userId }, { email: inv.email, role: inv.role, invitationId: inv.id });
}

/** Acepta la invitación con la cuenta de la sesión. El correo de la cuenta debe ser el invitado. */
export async function acceptInvitation(token: string, userId: string): Promise<{ organizationId: string }> {
  return withInvitation(token, async (tx, inv) => {
    const [user] = await tx.select({ email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, userId));
    if (!user || !user.isActive) throw new ForbiddenError("Tu cuenta no está activa.");
    if (user.email.toLowerCase() !== inv.email) {
      throw new ForbiddenError(`Esta invitación es para ${inv.email}. Cierra sesión e ingresa con esa cuenta.`);
    }
    await claim(tx, inv);
    await join(tx, inv, userId);
    return { organizationId: inv.organizationId };
  });
}

const newAccountSchema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre.").max(120),
  password: z.string(),
});

/** Crea la cuenta del invitado con SU propia contraseña y lo une a la empresa, en una sola transacción. */
export async function acceptInvitationWithNewAccount(token: string, raw: unknown): Promise<{ userId: string; organizationId: string }> {
  const { name, password } = parseOrThrow(newAccountSchema, raw);
  const problem = passwordProblem(password);
  if (problem) throw new ValidationError(problem, { password: [problem] });
  const passwordHash = await hashPassword(password);
  try {
    return await withInvitation(token, async (tx, inv) => {
      await claim(tx, inv);
      const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${inv.email}`);
      if (existing) throw new ConflictError("Ya existe una cuenta con este correo. Inicia sesión para aceptar la invitación.", "account_exists");
      const [user] = await tx.insert(users).values({ email: inv.email, name, passwordHash }).returning({ id: users.id });
      await join(tx, inv, user!.id);
      return { userId: user!.id, organizationId: inv.organizationId };
    });
  } catch (err) {
    if (isUniqueViolation(err, "users_email_uq")) {
      throw new ConflictError("Ya existe una cuenta con este correo. Inicia sesión para aceptar la invitación.", "account_exists");
    }
    throw err;
  }
}
