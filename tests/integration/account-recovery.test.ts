import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { passwordResetTokens, platformAuditLogs, users } from "@/server/db/schema";
import { withGlobalTx } from "@/server/db/tx";
import { testOutbox } from "@/server/mail";
import { authenticate, createSession, resolveSession } from "@/server/modules/auth/service";
import { isResetTokenValid, requestPasswordReset, RESET_LIMITS, resetPassword, revokeAllSessions } from "@/server/modules/auth/recovery";
import { createOrg, expectPgError, expectReject, PASSWORD, randomIp } from "./helpers";

const NEW_PASSWORD = "RecuperadaClave2026";
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

beforeEach(() => {
  testOutbox().length = 0;
});

function tokenFor(email: string): string | undefined {
  const mail = testOutbox().find((m) => m.to.toLowerCase() === email.toLowerCase());
  return mail?.text.match(/\/reset-password\/([A-Za-z0-9_-]{43})/)?.[1];
}

async function tokensOf(userId: string) {
  return withGlobalTx((tx) => tx.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userId)));
}

describe("recuperación de contraseña: flujo normal", () => {
  it("envía un enlace de un solo uso; al usarlo cambia la contraseña y cierra todas las sesiones", async () => {
    const org = await createOrg("Recupera");
    const s1 = await createSession(org.owner.userId);
    const s2 = await createSession(org.owner.userId);

    await requestPasswordReset(org.email.toUpperCase(), randomIp());
    const token = tokenFor(org.email)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // En la base solo está el hash.
    const [row] = await tokensOf(org.owner.userId);
    expect(row!.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    expect(await isResetTokenValid(token)).toBe(true);
    // Abrir la página (validar) no consume el token.
    expect(await isResetTokenValid(token)).toBe(true);

    await resetPassword(token, NEW_PASSWORD, randomIp());
    await expectReject(authenticate(org.email, PASSWORD, null), "UnauthenticatedError");
    expect(await authenticate(org.email, NEW_PASSWORD, null)).toBe(org.owner.userId);
    expect(await resolveSession(s1.token)).toBeNull();
    expect(await resolveSession(s2.token)).toBeNull();

    // Reutilizar el enlace falla.
    expect(await isResetTokenValid(token)).toBe(false);
    await expectReject(resetPassword(token, "OtraClave2026x", randomIp()), /ConflictError: El enlace no es válido/);
    expect(await authenticate(org.email, NEW_PASSWORD, null)).toBe(org.owner.userId);

    const audit = await withGlobalTx((tx) => tx.select({ action: platformAuditLogs.action }).from(platformAuditLogs).where(eq(platformAuditLogs.targetUserId, org.owner.userId)));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["account.password_reset_requested", "account.password_reset"]));
  });

  it("un enlace nuevo anula el anterior", async () => {
    const org = await createOrg("Dos enlaces");
    await requestPasswordReset(org.email, randomIp());
    const first = tokenFor(org.email)!;
    testOutbox().length = 0;
    await requestPasswordReset(org.email, randomIp());
    const second = tokenFor(org.email)!;
    expect(second).not.toBe(first);
    await expectReject(resetPassword(first, NEW_PASSWORD, randomIp()), /El enlace no es válido/);
    await resetPassword(second, NEW_PASSWORD, randomIp());
  });

  it("restablecer la contraseña quita el bloqueo por intentos fallidos", async () => {
    const org = await createOrg("Bloqueo por intentos");
    for (let i = 0; i < 5; i++) await expectReject(authenticate(org.email, "incorrecta-123", null), "UnauthenticatedError");
    await expectReject(authenticate(org.email, PASSWORD, null), "RateLimitError");
    await requestPasswordReset(org.email, randomIp());
    await resetPassword(tokenFor(org.email)!, NEW_PASSWORD, randomIp());
    expect(await authenticate(org.email, NEW_PASSWORD, null)).toBe(org.owner.userId);
  });
});

describe("recuperación de contraseña: respuestas neutras y abuso", () => {
  it("correos desconocidos o inválidos responden igual y no generan nada", async () => {
    const before = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from password_reset_tokens`);
    for (const email of [`nadie-${randomUUID()}@test.local`, "no-es-correo", "", null, 42]) {
      await expect(requestPasswordReset(email, randomIp())).resolves.toBeUndefined();
    }
    const after = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from password_reset_tokens`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(testOutbox()).toHaveLength(0);
  });

  it("una cuenta existente responde exactamente igual que una desconocida", async () => {
    const org = await createOrg("Neutral");
    const known = await requestPasswordReset(org.email, randomIp());
    const unknown = await requestPasswordReset(`otro-${randomUUID()}@test.local`, randomIp());
    expect(known).toEqual(unknown);
  });

  it("el límite por correo es silencioso: después del tercero no se envía nada, pero la respuesta no cambia", async () => {
    const org = await createOrg("Límite correo");
    for (let i = 0; i < RESET_LIMITS.requestPerEmail.limit + 2; i++) {
      await expect(requestPasswordReset(org.email, randomIp())).resolves.toBeUndefined();
    }
    expect(testOutbox().filter((m) => m.to === org.email)).toHaveLength(RESET_LIMITS.requestPerEmail.limit);
  });

  it("el límite por IP corta solicitudes y envíos de contraseña desde la misma dirección", async () => {
    const ip = randomIp();
    for (let i = 0; i < RESET_LIMITS.requestPerIp.limit; i++) await requestPasswordReset(`x-${randomUUID()}@test.local`, ip);
    await expectReject(requestPasswordReset(`x-${randomUUID()}@test.local`, ip), "RateLimitError");

    const ip2 = randomIp();
    const fake = "A".repeat(43);
    for (let i = 0; i < RESET_LIMITS.submitPerIp.limit; i++) await expectReject(resetPassword(fake, NEW_PASSWORD, ip2), "ConflictError");
    await expectReject(resetPassword(fake, NEW_PASSWORD, ip2), "RateLimitError");
  });

  it("los contadores de límites no guardan correos ni IP en claro", async () => {
    const email = `privado-${randomUUID()}@test.local`;
    const ip = randomIp();
    await requestPasswordReset(email, ip);
    const r = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from rate_limits where key like ${`%${email}%`} or key like ${`%${ip}%`}`);
    expect(r.rows[0]!.n).toBe(0);
  });
});

describe("recuperación de contraseña: tokens inválidos, vencidos y concurrencia", () => {
  it("tokens manipulados, de otro formato o el propio hash no sirven", async () => {
    const org = await createOrg("Manipulado");
    await requestPasswordReset(org.email, randomIp());
    const token = tokenFor(org.email)!;
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
    for (const bad of [tampered, "", "corto", `${token}x`, sha256(token), "' or 1=1 --", undefined, 7]) {
      expect(await isResetTokenValid(bad as string)).toBe(false);
      await expectReject(resetPassword(bad, NEW_PASSWORD, randomIp()), "ConflictError");
    }
    expect(await isResetTokenValid(token)).toBe(true);
  });

  it("un enlace vencido no cambia la contraseña", async () => {
    const org = await createOrg("Vencido");
    await requestPasswordReset(org.email, randomIp());
    const token = tokenFor(org.email)!;
    await withGlobalTx((tx) => tx.update(passwordResetTokens).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(passwordResetTokens.tokenHash, sha256(token))));
    expect(await isResetTokenValid(token)).toBe(false);
    await expectReject(resetPassword(token, NEW_PASSWORD, randomIp()), /El enlace no es válido/);
    expect(await authenticate(org.email, PASSWORD, null)).toBe(org.owner.userId);
  });

  it("una contraseña débil no consume el enlace", async () => {
    const org = await createOrg("Débil");
    await requestPasswordReset(org.email, randomIp());
    const token = tokenFor(org.email)!;
    await expectReject(resetPassword(token, "corta", randomIp()), "ValidationError");
    expect(await isResetTokenValid(token)).toBe(true);
  });

  it("10 envíos simultáneos del mismo enlace: solo uno cambia la contraseña", async () => {
    const org = await createOrg("Carrera reset");
    await requestPasswordReset(org.email, randomIp());
    const token = tokenFor(org.email)!;
    const candidates = Array.from({ length: 10 }, (_, i) => `${NEW_PASSWORD}${i}`);
    const results = await Promise.allSettled(candidates.map((p) => resetPassword(token, p, randomIp())));
    const ok = results.map((r, i) => (r.status === "fulfilled" ? i : -1)).filter((i) => i >= 0);
    expect(ok).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(String(r.reason)).toMatch(/El enlace no es válido/);
    const winner = candidates[ok[0]!]!;
    expect(await authenticate(org.email, winner, null)).toBe(org.owner.userId);
    const used = (await tokensOf(org.owner.userId)).filter((t) => t.usedAt);
    expect(used).toHaveLength(1);
  });

  it("el enlace de una cuenta no afecta a otra", async () => {
    const a = await createOrg("Cuenta A");
    const b = await createOrg("Cuenta B");
    const sb = await createSession(b.owner.userId);
    await requestPasswordReset(a.email, randomIp());
    await resetPassword(tokenFor(a.email)!, NEW_PASSWORD, randomIp());
    expect(await authenticate(b.email, PASSWORD, null)).toBe(b.owner.userId);
    expect(await resolveSession(sb.token)).not.toBeNull();
  });
});

describe("cerrar todas las sesiones", () => {
  it("cierra todas las sesiones de la cuenta (en todas sus empresas) y no toca las de otras cuentas", async () => {
    const a = await createOrg("Sesiones A");
    const other = await createOrg("Sesiones otra");
    const mine = await Promise.all([createSession(a.owner.userId), createSession(a.owner.userId), createSession(a.owner.userId)]);
    const theirs = await createSession(other.owner.userId);
    expect(await revokeAllSessions(a.owner.userId, randomIp())).toBe(3);
    for (const s of mine) expect(await resolveSession(s.token)).toBeNull();
    expect(await resolveSession(theirs.token)).not.toBeNull();
    // La contraseña sigue siendo la misma: solo se cerraron sesiones.
    expect(await authenticate(a.email, PASSWORD, null)).toBe(a.owner.userId);
  });
});

describe("permisos de la base sobre las tablas de seguridad", () => {
  it("la aplicación no puede borrar enlaces ni modificar la auditoría de plataforma", async () => {
    const org = await createOrg("Permisos tablas");
    await requestPasswordReset(org.email, randomIp());
    await expectPgError(withGlobalTx((tx) => tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, org.owner.userId))), "42501");
    await expectPgError(withGlobalTx((tx) => tx.update(platformAuditLogs).set({ action: "x" }).where(eq(platformAuditLogs.targetUserId, org.owner.userId))), "42501");
    await expectPgError(withGlobalTx((tx) => tx.delete(platformAuditLogs).where(eq(platformAuditLogs.targetUserId, org.owner.userId))), "42501");
  });

  it("estado de bloqueo coherente: la base rechaza una cuenta inactiva sin fecha de bloqueo", async () => {
    const org = await createOrg("Coherencia");
    await expectPgError(withGlobalTx((tx) => tx.update(users).set({ isActive: false }).where(eq(users.id, org.owner.userId))), "23514");
  });
});
