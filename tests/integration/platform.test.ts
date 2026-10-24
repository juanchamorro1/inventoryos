import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { platformAdmins, platformAuditLogs, sessions } from "@/server/db/schema";
import { withGlobalTx } from "@/server/db/tx";
import { testOutbox } from "@/server/mail";
import { createApiKey, authenticateApiKey } from "@/server/modules/api-keys/service";
import { authenticate, createSession, listUserOrganizations, resolveSession, type SessionInfo } from "@/server/modules/auth/service";
import { isResetTokenValid, requestPasswordReset, resetPassword } from "@/server/modules/auth/recovery";
import { acceptInvitation, createInvitation } from "@/server/modules/invitations/service";
import {
  blockUser,
  findUserByEmail,
  isPlatformAdmin,
  issuePasswordResetLink,
  requirePlatformAdmin,
  revokeUserSessions,
  unblockUser,
  type PlatformContext,
} from "@/server/modules/platform/service";
import { createOrg, expectPgError, expectReject, grantPlatformAdmin, inviteNewMember, PASSWORD, randomIp } from "./helpers";

const NEW_PASSWORD = "PlataformaClave2026";

beforeEach(() => {
  testOutbox().length = 0;
});

async function sessionOf(userId: string): Promise<{ token: string; info: SessionInfo }> {
  const { token } = await createSession(userId);
  return { token, info: (await resolveSession(token))! };
}

/** Un administrador de plataforma con sesión recién iniciada. */
async function platformAdmin(): Promise<PlatformContext & { email: string }> {
  const org = await createOrg("Operador");
  await grantPlatformAdmin(org.owner.userId);
  const { info } = await sessionOf(org.owner.userId);
  return { ...(await requirePlatformAdmin(info, randomIp())), email: org.email };
}

describe("autorización de plataforma", () => {
  it("ser propietario o administrador de una empresa no da poderes de plataforma", async () => {
    const org = await createOrg("Dueña");
    const { userId: adminId } = await inviteNewMember(org.owner, "admin");
    const victim = await createOrg("Objetivo");
    for (const userId of [org.owner.userId, adminId]) {
      const { info } = await sessionOf(userId);
      expect(await isPlatformAdmin(userId)).toBe(false);
      await expectReject(requirePlatformAdmin(info, null), "NotFoundError");
      // Aun fabricando un contexto, cada operación revalida en la base.
      const forged: PlatformContext = { userId, ip: null, sessionCreatedAt: new Date() };
      await expectReject(blockUser(forged, victim.owner.userId, "Intento indebido"), "NotFoundError");
      await expectReject(unblockUser(forged, victim.owner.userId), "NotFoundError");
      await expectReject(revokeUserSessions(forged, victim.owner.userId), "NotFoundError");
      await expectReject(issuePasswordResetLink(forged, victim.owner.userId), "NotFoundError");
      await expectReject(findUserByEmail(forged, victim.email), "NotFoundError");
    }
    await expectReject(requirePlatformAdmin(null, null), "NotFoundError");
  });

  it("la aplicación no puede otorgarse el rol: platform_admins es de solo lectura para su rol", async () => {
    const org = await createOrg("Escalada");
    await expectPgError(withGlobalTx((tx) => tx.insert(platformAdmins).values({ userId: org.owner.userId })), "42501");
    await expectPgError(withGlobalTx((tx) => tx.execute(sql`update platform_admins set note = 'x'`)), "42501");
    await expectPgError(withGlobalTx((tx) => tx.execute(sql`delete from platform_admins`)), "42501");
    expect(await isPlatformAdmin(org.owner.userId)).toBe(false);
  });

  it("exige una sesión reciente y deja de funcionar si se retira el rol o se bloquea al administrador", async () => {
    const org = await createOrg("Operador viejo");
    await grantPlatformAdmin(org.owner.userId);
    const target = await createOrg("Destino");
    const { token, info } = await sessionOf(org.owner.userId);
    await withGlobalTx((tx) => tx.update(sessions).set({ createdAt: sql`now() - interval '13 hours'` }).where(eq(sessions.tokenHash, info.tokenHash)));
    const stale = await requirePlatformAdmin((await resolveSession(token))!, null);
    await expectReject(revokeUserSessions(stale, target.owner.userId), /ForbiddenError: Por seguridad, vuelve a iniciar sesión/);

    const fresh = await requirePlatformAdmin((await sessionOf(org.owner.userId)).info, null);
    expect(await revokeUserSessions(fresh, target.owner.userId)).toBe(0);
    // Retirar el rol (con el rol dueño, como el script) corta el acceso aunque el contexto ya exista.
    const c = new (await import("pg")).default.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    await c.connect();
    await c.query("delete from platform_admins where user_id = $1", [org.owner.userId]);
    await c.end();
    await expectReject(revokeUserSessions(fresh, target.owner.userId), "NotFoundError");
  });
});

describe("bloqueo de cuentas", () => {
  it("bloquear cierra todas las sesiones (en todas las empresas), impide entrar y desactiva claves API e invitaciones", async () => {
    const admin = await platformAdmin();
    const a = await createOrg("Bloqueo A");
    const b = await createOrg("Bloqueo B");
    // La persona es propietaria de A y miembro de B; tiene sesiones con cada empresa activa.
    const { token: invB } = await createInvitation(b.owner, { email: a.email, role: "admin" });
    await acceptInvitation(invB, a.owner.userId);
    const s1 = await sessionOf(a.owner.userId);
    const s2 = await sessionOf(a.owner.userId);
    await withGlobalTx((tx) => tx.update(sessions).set({ activeOrganizationId: b.organizationId }).where(eq(sessions.tokenHash, s2.info.tokenHash)));
    const { key } = await createApiKey(a.owner, { name: "Integración", scopes: ["catalog:read"] });
    const pendingInv = await createInvitation(a.owner, { email: `inv-${randomUUID()}@test.local`, role: "staff" });
    const other = await sessionOf(b.owner.userId);

    await blockUser(admin, a.owner.userId, "Acceso sospechoso reportado");

    expect(await resolveSession(s1.token)).toBeNull();
    expect(await resolveSession(s2.token)).toBeNull();
    expect(await resolveSession(other.token)).not.toBeNull();
    await expectReject(authenticate(a.email, PASSWORD, null), /UnauthenticatedError: Correo o contraseña incorrectos/);
    await expectReject(authenticateApiKey(`Bearer ${key}`), "UnauthenticatedError");
    // Una invitación creada por la cuenta bloqueada deja de servir.
    await expectReject(
      (await import("@/server/modules/invitations/service")).acceptInvitationWithNewAccount(pendingInv.token, { name: "Nueva", password: NEW_PASSWORD }),
      /ya no es válida/,
    );
    // La recuperación tampoco la reactiva: no se envía nada y la respuesta es la misma.
    await expect(requestPasswordReset(a.email, randomIp())).resolves.toBeUndefined();
    expect(testOutbox()).toHaveLength(0);
    await expectReject(issuePasswordResetLink(admin, a.owner.userId), /desbloquéala/);
    // Las membresías se conservan (no se borra información de las empresas).
    expect((await listUserOrganizations(a.owner.userId)).length).toBe(2);

    const found = await findUserByEmail(admin, a.email);
    expect(found).toMatchObject({ isActive: false, blockedReason: "Acceso sospechoso reportado", activeSessions: 0 });
  });

  it("un bloqueo anula los enlaces de recuperación pendientes", async () => {
    const admin = await platformAdmin();
    const org = await createOrg("Enlace pendiente");
    await requestPasswordReset(org.email, randomIp());
    const token = testOutbox()[0]!.text.match(/\/reset-password\/([A-Za-z0-9_-]{43})/)![1]!;
    await blockUser(admin, org.owner.userId, "Fraude");
    expect(await isResetTokenValid(token)).toBe(false);
    await expectReject(resetPassword(token, NEW_PASSWORD, randomIp()), /El enlace no es válido/);
    await unblockUser(admin, org.owner.userId);
    // Desbloquear no revive el enlace anulado.
    await expectReject(resetPassword(token, NEW_PASSWORD, randomIp()), /El enlace no es válido/);
  });

  it("desbloquear permite volver a entrar, sin restaurar las sesiones cerradas", async () => {
    const admin = await platformAdmin();
    const org = await createOrg("Desbloqueo");
    const s = await sessionOf(org.owner.userId);
    await blockUser(admin, org.owner.userId, "Revisión");
    await expectReject(blockUser(admin, org.owner.userId, "Otra vez"), /ya está bloqueada/);
    await unblockUser(admin, org.owner.userId);
    await expectReject(unblockUser(admin, org.owner.userId), /no está bloqueada/);
    expect(await resolveSession(s.token)).toBeNull();
    expect(await authenticate(org.email, PASSWORD, null)).toBe(org.owner.userId);
  });

  it("no se puede bloquear la propia cuenta ni la de otro administrador de plataforma; el motivo es obligatorio", async () => {
    const admin = await platformAdmin();
    const other = await platformAdmin();
    const org = await createOrg("Motivo");
    await expectReject(blockUser(admin, admin.userId, "Me bloqueo"), "ForbiddenError");
    await expectReject(blockUser(admin, other.userId, "Pelea"), /administradora de plataforma/);
    await expectReject(blockUser(admin, org.owner.userId, ""), "ValidationError");
    await expectReject(blockUser(admin, randomUUID(), "No existe"), "NotFoundError");
    await expectReject(blockUser(admin, "no-es-uuid", "Formato"), "NotFoundError");
  });

  it("bloqueos y restablecimientos simultáneos no dejan la cuenta activa con la contraseña nueva", async () => {
    const admin = await platformAdmin();
    const org = await createOrg("Carrera bloqueo");
    const { token } = await issuePasswordResetLink(admin, org.owner.userId);
    const [blocked, reset] = await Promise.allSettled([blockUser(admin, org.owner.userId, "Carrera"), resetPassword(token, NEW_PASSWORD, randomIp())]);
    expect(blocked.status).toBe("fulfilled");
    // Gane quien gane, la cuenta queda bloqueada y no se puede entrar.
    await expectReject(authenticate(org.email, NEW_PASSWORD, null), "UnauthenticatedError");
    await expectReject(authenticate(org.email, PASSWORD, null), "UnauthenticatedError");
    expect(["fulfilled", "rejected"]).toContain(reset.status);
  });
});

describe("herramientas de plataforma", () => {
  it("el enlace generado por plataforma lo usa la persona; el administrador nunca conoce la contraseña", async () => {
    const admin = await platformAdmin();
    const org = await createOrg("Soporte");
    const s = await sessionOf(org.owner.userId);
    const { token, expiresAt } = await issuePasswordResetLink(admin, org.owner.userId);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    await resetPassword(token, NEW_PASSWORD, randomIp());
    expect(await authenticate(org.email, NEW_PASSWORD, null)).toBe(org.owner.userId);
    expect(await resolveSession(s.token)).toBeNull();
    await expectReject(resetPassword(token, "OtraMas2026x", randomIp()), /El enlace no es válido/);
  });

  it("cerrar las sesiones de una cuenta no afecta a otras, y todo queda auditado", async () => {
    const admin = await platformAdmin();
    const a = await createOrg("Cierre A");
    const b = await createOrg("Cierre B");
    const sa = await sessionOf(a.owner.userId);
    await sessionOf(a.owner.userId);
    const sb = await sessionOf(b.owner.userId);
    expect(await revokeUserSessions(admin, a.owner.userId)).toBe(2);
    expect(await resolveSession(sa.token)).toBeNull();
    expect(await resolveSession(sb.token)).not.toBeNull();
    await blockUser(admin, a.owner.userId, "Prueba de auditoría");
    await unblockUser(admin, a.owner.userId);
    const log = await withGlobalTx((tx) =>
      tx.select({ action: platformAuditLogs.action, actor: platformAuditLogs.actorUserId }).from(platformAuditLogs).where(eq(platformAuditLogs.targetUserId, a.owner.userId)),
    );
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["platform.sessions_revoked", "platform.user_blocked", "platform.user_unblocked"]));
    expect(log.filter((l) => l.action.startsWith("platform.")).every((l) => l.actor === admin.userId)).toBe(true);
  });

  it("la búsqueda es por correo exacto y solo devuelve datos de la cuenta, no de sus empresas", async () => {
    const admin = await platformAdmin();
    const org = await createOrg("Búsqueda");
    const found = await findUserByEmail(admin, org.email.toUpperCase());
    expect(Object.keys(found!).sort()).toEqual(["activeSessions", "blockedAt", "blockedReason", "createdAt", "email", "id", "isActive", "isPlatformAdmin", "lastLoginAt", "name"]);
    expect(await findUserByEmail(admin, `nadie-${randomUUID()}@test.local`)).toBeNull();
    await expectReject(findUserByEmail(admin, "no-es-correo"), "ValidationError");
  });
});
