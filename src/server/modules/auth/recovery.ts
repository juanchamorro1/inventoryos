import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { loginAttempts, passwordResetTokens, platformAuditLogs, sessions, users } from "../../db/schema";
import { withGlobalTx } from "../../db/tx";
import { env } from "../../env";
import { sendMail } from "../../mail";
import { ConflictError, ValidationError } from "../../platform/errors";
import { consumeRateLimit, enforceRateLimit } from "../../platform/rate-limit";
import { hashPassword, passwordProblem } from "./password";
import { emailSchema } from "./service";

// Recuperación de cuentas.
//   - El token (32 bytes aleatorios) solo viaja en el enlace; en la base se guarda su SHA-256.
//   - Vence (30 min si lo pide la persona, 24 h si lo genera un administrador de plataforma) y es de un solo uso:
//     se consume con un UPDATE condicionado, así que de dos solicitudes simultáneas solo una cambia la contraseña.
//   - Las respuestas públicas son idénticas exista o no la cuenta.

export const SELF_RESET_TTL_MINUTES = 30;
export const PLATFORM_RESET_TTL_HOURS = 24;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// Límites (ventana fija).
export const RESET_LIMITS = {
  requestPerIp: { limit: 10, windowSeconds: 3600 },
  requestPerEmail: { limit: 3, windowSeconds: 3600 },
  submitPerIp: { limit: 20, windowSeconds: 900 },
} as const;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const INVALID_RESET_LINK = "El enlace no es válido, ya se usó o venció. Solicita uno nuevo.";

export type PlatformAuditEntry = { actorUserId: string | null; action: string; targetUserId: string | null; data?: Record<string, unknown>; ip?: string | null };

export async function platformAudit(tx: Tx, e: PlatformAuditEntry) {
  await tx.insert(platformAuditLogs).values({ actorUserId: e.actorUserId, action: e.action, targetUserId: e.targetUserId, data: e.data ?? {}, ip: e.ip ?? null });
}

/** Anula los enlaces de recuperación sin usar de la cuenta. */
export async function revokeResetTokens(tx: Tx, userId: string) {
  await tx
    .update(passwordResetTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt), isNull(passwordResetTokens.revokedAt)));
}

/** Emite un enlace nuevo (anula los anteriores). Devuelve el token en claro: solo se entrega una vez. */
export async function issueResetToken(tx: Tx, userId: string, origin: "self" | "platform"): Promise<{ token: string; expiresAt: Date }> {
  await revokeResetTokens(tx, userId);
  const token = randomBytes(32).toString("base64url");
  const ttl = origin === "self" ? SELF_RESET_TTL_MINUTES * 60_000 : PLATFORM_RESET_TTL_HOURS * 3_600_000;
  const expiresAt = new Date(Date.now() + ttl);
  await tx.insert(passwordResetTokens).values({ userId, tokenHash: hashToken(token), origin, expiresAt });
  return { token, expiresAt };
}

export const resetLink = (token: string) => `${env().APP_URL}/reset-password/${token}`;

/**
 * Solicitud pública de recuperación. No revela nada: siempre termina igual (salvo el límite por IP, que no
 * depende de la cuenta). Solo si la cuenta existe y está activa se emite un enlace y se envía por correo.
 */
export async function requestPasswordReset(rawEmail: unknown, ip: string | null): Promise<void> {
  await enforceRateLimit("reset-request-ip", ip ?? "sin-ip", RESET_LIMITS.requestPerIp.limit, RESET_LIMITS.requestPerIp.windowSeconds);
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return;
  const email = parsed.data;
  // Por correo el límite es silencioso: superarlo no cambia la respuesta (no permite saber si hay cuenta).
  if (!(await consumeRateLimit("reset-request-email", email, RESET_LIMITS.requestPerEmail.limit, RESET_LIMITS.requestPerEmail.windowSeconds))) return;

  const issued = await withGlobalTx(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, eq(users.isActive, true)));
    if (!user) return null;
    const { token } = await issueResetToken(tx, user.id, "self");
    await platformAudit(tx, { actorUserId: null, action: "account.password_reset_requested", targetUserId: user.id, ip });
    return { user, token };
  });
  if (!issued) return;
  await sendMail({
    to: issued.user.email,
    subject: "Restablece tu contraseña de InventoryOS",
    text:
      `Hola, ${issued.user.name}.\n\nPara elegir una contraseña nueva abre este enlace (vence en ${SELF_RESET_TTL_MINUTES} minutos y sirve una sola vez):\n` +
      `${resetLink(issued.token)}\n\nSi no lo pediste, ignora este mensaje: tu contraseña no cambia.`,
  });
}

/** Indica si el enlace sigue sirviendo (no lo consume). Solo lo conoce quien tiene el token. */
export async function isResetTokenValid(token: string): Promise<boolean> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return false;
  const [row] = await withGlobalTx((tx) =>
    tx
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .innerJoin(users, eq(users.id, passwordResetTokens.userId))
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(token)),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.revokedAt),
          gt(passwordResetTokens.expiresAt, sql`now()`),
          eq(users.isActive, true),
        ),
      ),
  );
  return Boolean(row);
}

/**
 * Cambia la contraseña con un enlace de recuperación válido. Cierra TODAS las sesiones de la cuenta,
 * anula los demás enlaces y limpia los intentos fallidos de inicio de sesión.
 */
export async function resetPassword(token: unknown, newPassword: string, ip: string | null): Promise<{ userId: string }> {
  await enforceRateLimit("reset-submit-ip", ip ?? "sin-ip", RESET_LIMITS.submitPerIp.limit, RESET_LIMITS.submitPerIp.windowSeconds);
  if (typeof token !== "string" || !TOKEN_RE.test(token)) throw new ConflictError(INVALID_RESET_LINK, "invalid_reset_link");
  const problem = passwordProblem(newPassword);
  if (problem) throw new ValidationError(problem, { password: [problem] });
  const passwordHash = await hashPassword(newPassword);
  const tokenHash = hashToken(token);
  return withGlobalTx(async (tx) => {
    // Primero se bloquea la fila del usuario (mismo orden que el bloqueo de cuentas, para no provocar interbloqueos)
    // y después se consume el token con un UPDATE condicionado: de varias solicitudes simultáneas solo una lo obtiene.
    const [target] = await tx.select({ userId: passwordResetTokens.userId }).from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash));
    if (!target) throw new ConflictError(INVALID_RESET_LINK, "invalid_reset_link");
    const [user] = await tx.select({ email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, target.userId)).for("update");
    const [claimed] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.revokedAt),
          gt(passwordResetTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: passwordResetTokens.userId, origin: passwordResetTokens.origin });
    if (!claimed || !user?.isActive) throw new ConflictError(INVALID_RESET_LINK, "invalid_reset_link");
    await tx.update(users).set({ passwordHash }).where(eq(users.id, claimed.userId));
    await tx.delete(sessions).where(eq(sessions.userId, claimed.userId));
    await revokeResetTokens(tx, claimed.userId);
    await tx.delete(loginAttempts).where(and(eq(loginAttempts.email, user.email.toLowerCase()), eq(loginAttempts.success, false)));
    await platformAudit(tx, { actorUserId: claimed.userId, action: "account.password_reset", targetUserId: claimed.userId, data: { origin: claimed.origin }, ip });
    return { userId: claimed.userId };
  });
}

/** Cierra todas las sesiones de la cuenta (incluida la actual), en todas las empresas. */
export async function revokeAllSessions(userId: string, ip: string | null): Promise<number> {
  return withGlobalTx(async (tx) => {
    const deleted = await tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ t: sessions.tokenHash });
    await platformAudit(tx, { actorUserId: userId, action: "account.sessions_revoked", targetUserId: userId, data: { count: deleted.length }, ip });
    return deleted.length;
  });
}
