import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { invitations, memberships, organizations, users } from "@/server/db/schema";
import { withGlobalTx, withTenantTx } from "@/server/db/tx";
import { authenticate, buildTenantContext, listUserOrganizations } from "@/server/modules/auth/service";
import {
  acceptInvitation,
  acceptInvitationWithNewAccount,
  createInvitation,
  getInvitationByToken,
  listInvitations,
  revokeInvitation,
} from "@/server/modules/invitations/service";
import { updateMember } from "@/server/modules/organizations/service";
import { createOrg, expectPgError, expectReject, inviteNewMember, memberCtx, PASSWORD } from "./helpers";

const NEW_PASSWORD = "MiPropiaClave2026";
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const email = (p = "inv") => `${p}-${randomUUID()}@test.local`;

async function passwordHashOf(userId: string) {
  const [u] = await withGlobalTx((tx) => tx.select({ h: users.passwordHash }).from(users).where(eq(users.id, userId)));
  return u!.h;
}

async function expire(ctx: Parameters<typeof withTenantTx>[0], id: string) {
  await withTenantTx(ctx, (tx) => tx.update(invitations).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(invitations.id, id)));
}

describe("invitaciones: flujo normal", () => {
  it("la persona nueva crea su cuenta con su propia contraseña y queda con el rol invitado", async () => {
    const org = await createOrg("Invita Uno");
    const to = email();
    const { id, token, expiresAt } = await createInvitation(org.owner, { email: to.toUpperCase(), role: "staff" });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 3_600_000);

    const view = await getInvitationByToken(token);
    expect(view).toMatchObject({ organizationName: "Invita Uno", email: to, role: "staff", state: "valid", accountExists: false });

    // Antes de aceptar no existe la cuenta ni la membresía.
    const [before] = await withGlobalTx((tx) => tx.select({ id: users.id }).from(users).where(eq(users.email, to)));
    expect(before).toBeUndefined();

    const { userId, organizationId } = await acceptInvitationWithNewAccount(token, { name: "Nueva Persona", password: NEW_PASSWORD });
    expect(organizationId).toBe(org.organizationId);
    expect(await authenticate(to, NEW_PASSWORD, null)).toBe(userId);
    const ctx = await buildTenantContext(userId, org.organizationId);
    expect(ctx.role).toBe("staff");

    // En la base solo está el hash del token y la invitación quedó cerrada.
    const [row] = await withTenantTx(org.owner, (tx) => tx.select().from(invitations).where(eq(invitations.id, id)));
    expect(row).toMatchObject({ status: "accepted", acceptedBy: userId, tokenHash: sha256(token) });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await listInvitations(org.owner)).toEqual([]);
  });

  it("una cuenta existente debe iniciar sesión y aceptar; su contraseña no cambia", async () => {
    const a = await createOrg("Empresa A");
    const b = await createOrg("Empresa B");
    const hashBefore = await passwordHashOf(b.owner.userId);
    const { token } = await createInvitation(a.owner, { email: b.email, role: "viewer" });

    expect((await getInvitationByToken(token)).accountExists).toBe(true);
    // No se vinculó en silencio.
    expect((await listUserOrganizations(b.owner.userId)).map((o) => o.id)).toEqual([b.organizationId]);
    // No se puede "crear" una cuenta encima de la existente.
    await expectReject(acceptInvitationWithNewAccount(token, { name: "Intruso", password: NEW_PASSWORD }), /ConflictError: Ya existe una cuenta/);

    await acceptInvitation(token, b.owner.userId);
    const orgs = await listUserOrganizations(b.owner.userId);
    expect(orgs.map((o) => o.id).sort()).toEqual([a.organizationId, b.organizationId].sort());
    expect(orgs.find((o) => o.id === a.organizationId)?.role).toBe("viewer");
    expect(orgs.find((o) => o.id === b.organizationId)?.role).toBe("owner");
    expect(await passwordHashOf(b.owner.userId)).toBe(hashBefore);
    expect(await authenticate(b.email, PASSWORD, null)).toBe(b.owner.userId);
  });

  it("una invitación nueva al mismo correo anula la anterior", async () => {
    const org = await createOrg("Reenvío");
    const to = email();
    const first = await createInvitation(org.owner, { email: to, role: "staff" });
    const second = await createInvitation(org.owner, { email: to, role: "manager" });
    expect((await getInvitationByToken(first.token)).state).toBe("revoked");
    await expectReject(acceptInvitationWithNewAccount(first.token, { name: "Uno", password: NEW_PASSWORD }), /invitación fue anulada/);
    const { userId } = await acceptInvitationWithNewAccount(second.token, { name: "Dos", password: NEW_PASSWORD });
    expect((await buildTenantContext(userId, org.organizationId)).role).toBe("manager");
  });
});

describe("invitaciones: ataques", () => {
  it("ninguna empresa puede fijar la contraseña de una cuenta ni vincular una cuenta ajena", async () => {
    const attacker = await createOrg("Atacante");
    const victimOrg = await createOrg("Víctima");
    const hashBefore = await passwordHashOf(victimOrg.owner.userId);
    // Campos extra (password, name) se ignoran: el servicio solo acepta correo y rol.
    const { token } = await createInvitation(attacker.owner, { email: victimOrg.email, role: "admin", password: "ClaveDelAtacante1", name: "X" });
    expect(await passwordHashOf(victimOrg.owner.userId)).toBe(hashBefore);
    await expectReject(authenticate(victimOrg.email, "ClaveDelAtacante1", null), "UnauthenticatedError");
    // El atacante tiene el enlace, pero sin la contraseña de la víctima no puede usarlo.
    await expectReject(acceptInvitation(token, attacker.owner.userId), /ForbiddenError: Esta invitación es para/);
    await expectReject(acceptInvitationWithNewAccount(token, { name: "Xavier", password: "ClaveDelAtacante1" }), /Ya existe una cuenta/);
    expect((await listUserOrganizations(victimOrg.owner.userId)).map((o) => o.id)).toEqual([victimOrg.organizationId]);
  });

  it("una cuenta creada por invitación de A no da acceso a B sin la invitación de B", async () => {
    const a = await createOrg("A preaprovisiona");
    const b = await createOrg("B víctima");
    const target = email("contador");
    // A invita el correo y crea la cuenta él mismo (conoce la contraseña porque la eligió al aceptar).
    const { userId } = await inviteNewMember(a.owner, "viewer", target);
    // B invita al mismo correo: la cuenta existe pero NO queda vinculada hasta que se acepte con el token de B.
    const { token: tokenB } = await createInvitation(b.owner, { email: target, role: "admin" });
    await expectReject(buildTenantContext(userId, b.organizationId), "NotFoundError");
    expect((await listUserOrganizations(userId)).map((o) => o.id)).toEqual([a.organizationId]);
    // Solo quien tenga el enlace de B puede aceptarlo (y debe estar autenticado con esa cuenta).
    expect(tokenB).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("tokens inválidos, manipulados o de otro formato no revelan nada", async () => {
    const org = await createOrg("Tokens");
    const { token } = await createInvitation(org.owner, { email: email(), role: "staff" });
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
    for (const bad of [tampered, "", "corto", `${token}x`, sha256(token), "../../etc/passwd", "' or 1=1 --"]) {
      await expectReject(getInvitationByToken(bad), "NotFoundError");
      await expectReject(acceptInvitationWithNewAccount(bad, { name: "Nadie", password: NEW_PASSWORD }), "NotFoundError");
    }
  });

  it("permisos: solo members.manage invita, sin roles superiores, y al aceptar se revalida a quien invitó", async () => {
    const org = await createOrg("Permisos");
    await withTenantTx(org.owner, (tx) => tx.update(organizations).set({ plan: "pro" }).where(eq(organizations.id, org.organizationId)));
    const manager = await memberCtx(org, "manager");
    await expectReject(createInvitation(manager, { email: email(), role: "viewer" }), "ForbiddenError");
    await expectReject(listInvitations(manager), "ForbiddenError");

    const { userId: adminId } = await inviteNewMember(org.owner, "admin");
    const admin = await buildTenantContext(adminId, org.organizationId);
    await expectReject(createInvitation(admin, { email: email(), role: "owner" }), "ForbiddenError");

    // El administrador invita y luego lo desactivan: su invitación deja de servir.
    const { token } = await createInvitation(admin, { email: email(), role: "admin" });
    await updateMember(org.owner, adminId, { role: "admin", status: "disabled" });
    await expectReject(acceptInvitationWithNewAccount(token, { name: "Tarde", password: NEW_PASSWORD }), /ya no es válida/);
    // La transacción fallida no dejó la cuenta creada ni la invitación consumida.
    expect((await getInvitationByToken(token)).state).toBe("valid");
  });

  it("validaciones de la cuenta nueva: contraseña débil y nombre vacío no consumen la invitación", async () => {
    const org = await createOrg("Validación");
    const { token } = await createInvitation(org.owner, { email: email(), role: "staff" });
    await expectReject(acceptInvitationWithNewAccount(token, { name: "Ana", password: "corta" }), "ValidationError");
    await expectReject(acceptInvitationWithNewAccount(token, { name: "", password: NEW_PASSWORD }), "ValidationError");
    expect((await getInvitationByToken(token)).state).toBe("valid");
  });

  it("no se invita a quien ya es miembro (activo o desactivado)", async () => {
    const org = await createOrg("Ya miembro");
    const { userId, email: to } = await inviteNewMember(org.owner, "staff");
    await expectReject(createInvitation(org.owner, { email: to, role: "manager" }), /ConflictError: Esa persona ya es miembro/);
    await updateMember(org.owner, userId, { role: "staff", status: "disabled" });
    await expectReject(createInvitation(org.owner, { email: to, role: "staff" }), /desactivada/);
  });
});

describe("invitaciones: vencimiento, anulación y reutilización", () => {
  it("una invitación vencida no se puede aceptar", async () => {
    const org = await createOrg("Vencida");
    const existing = await createOrg("Cuenta existente");
    const fresh = await createInvitation(org.owner, { email: email(), role: "staff" });
    const forExisting = await createInvitation(org.owner, { email: existing.email, role: "staff" });
    await expire(org.owner, fresh.id);
    await expire(org.owner, forExisting.id);
    expect((await getInvitationByToken(fresh.token)).state).toBe("expired");
    await expectReject(acceptInvitationWithNewAccount(fresh.token, { name: "Tarde", password: NEW_PASSWORD }), /venció/);
    await expectReject(acceptInvitation(forExisting.token, existing.owner.userId), /venció/);
    expect((await listUserOrganizations(existing.owner.userId)).map((o) => o.id)).toEqual([existing.organizationId]);
  });

  it("una invitación anulada no se puede aceptar, y anularla libera el cupo del plan", async () => {
    const org = await createOrg("Anulada");
    const one = await createInvitation(org.owner, { email: email(), role: "viewer" });
    await createInvitation(org.owner, { email: email(), role: "viewer" });
    // Plan gratis: 3 usuarios = propietario + 2 invitaciones pendientes.
    await expectReject(createInvitation(org.owner, { email: email(), role: "viewer" }), "PlanLimitError");
    await revokeInvitation(org.owner, one.id);
    await expectReject(revokeInvitation(org.owner, one.id), "NotFoundError");
    await expectReject(acceptInvitationWithNewAccount(one.token, { name: "Anulado", password: NEW_PASSWORD }), /anulada/);
    await createInvitation(org.owner, { email: email(), role: "viewer" });
  });

  it("el token es de un solo uso", async () => {
    const org = await createOrg("Un uso");
    const { token } = await createInvitation(org.owner, { email: email(), role: "staff" });
    await acceptInvitationWithNewAccount(token, { name: "Primera", password: NEW_PASSWORD });
    expect((await getInvitationByToken(token)).state).toBe("accepted");
    await expectReject(acceptInvitationWithNewAccount(token, { name: "Segunda", password: NEW_PASSWORD }), /ya fue usada/);

    const other = await createOrg("Otra cuenta");
    const { token: t2 } = await createInvitation(org.owner, { email: other.email, role: "viewer" });
    await acceptInvitation(t2, other.owner.userId);
    await expectReject(acceptInvitation(t2, other.owner.userId), /ya fue usada/);
  });
});

describe("invitaciones: concurrencia", () => {
  it("10 aceptaciones simultáneas del mismo enlace crean una sola cuenta y una sola membresía", async () => {
    const org = await createOrg("Carrera nueva");
    const to = email();
    const { token } = await createInvitation(org.owner, { email: to, role: "staff" });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => acceptInvitationWithNewAccount(token, { name: `Intento ${i}`, password: `${NEW_PASSWORD}${i}` })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(String(r.reason)).toMatch(/ya fue usada|Ya existe una cuenta/);
    const accounts = await withGlobalTx((tx) => tx.select({ id: users.id }).from(users).where(eq(users.email, to)));
    expect(accounts).toHaveLength(1);
    const members = await withTenantTx(org.owner, (tx) => tx.select().from(memberships).where(eq(memberships.userId, accounts[0]!.id)));
    expect(members).toHaveLength(1);
  });

  it("10 aceptaciones simultáneas con una cuenta existente producen una sola membresía", async () => {
    const org = await createOrg("Carrera existente");
    const person = await createOrg("Persona");
    const { token } = await createInvitation(org.owner, { email: person.email, role: "viewer" });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => acceptInvitation(token, person.owner.userId)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const members = await withTenantTx(org.owner, (tx) => tx.select().from(memberships).where(eq(memberships.userId, person.owner.userId)));
    expect(members).toHaveLength(1);
  });

  it("invitaciones simultáneas no superan el límite de usuarios del plan", async () => {
    const org = await createOrg("Carrera de cupos");
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => createInvitation(org.owner, { email: email(), role: "viewer" })));
    // Plan gratis: 3 usuarios, el propietario ocupa uno.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await listInvitations(org.owner)).length).toBe(2);
  });
});

describe("invitaciones: aislamiento multiempresa", () => {
  it("B no ve ni anula invitaciones de A, y RLS oculta las filas sin contexto o con otra empresa", async () => {
    const a = await createOrg("Aislada A");
    const b = await createOrg("Aislada B");
    const inv = await createInvitation(a.owner, { email: email(), role: "staff" });
    expect(await listInvitations(b.owner)).toEqual([]);
    await expectReject(revokeInvitation(b.owner, inv.id), "NotFoundError");
    expect((await getInvitationByToken(inv.token)).state).toBe("valid");

    const none = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from invitations`);
    expect(none.rows[0]!.n).toBe(0);
    const asB = await withTenantTx(b.owner, (tx) => tx.select().from(invitations).where(eq(invitations.id, inv.id)));
    expect(asB).toEqual([]);
    // La búsqueda por hash solo muestra esa fila, nunca las demás de la empresa.
    await createInvitation(a.owner, { email: email(), role: "staff" });
    const byHash = await getDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.invite_token_hash', ${sha256(inv.token)}, true)`);
      return tx.select({ id: invitations.id }).from(invitations);
    });
    expect(byHash.map((r) => r.id)).toEqual([inv.id]);
  });

  it("la base rechaza invitaciones con organization_id ajeno y el rol de la app no puede borrarlas", async () => {
    const a = await createOrg("RLS A");
    const b = await createOrg("RLS B");
    await expectPgError(
      withTenantTx(a.owner, (tx) =>
        tx.insert(invitations).values({ organizationId: b.organizationId, email: email(), role: "admin", tokenHash: sha256(randomUUID()), invitedBy: a.owner.userId, expiresAt: new Date(Date.now() + 3_600_000) }),
      ),
      "42501",
    );
    const inv = await createInvitation(a.owner, { email: email(), role: "staff" });
    await expectPgError(withTenantTx(a.owner, (tx) => tx.delete(invitations).where(eq(invitations.id, inv.id))), "42501");
    // Con el hash fijado (sin empresa) la fila se puede leer pero no modificar.
    const updated = await getDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.invite_token_hash', ${sha256(inv.token)}, true)`);
      return tx.update(invitations).set({ role: "owner" }).where(eq(invitations.id, inv.id)).returning({ id: invitations.id });
    });
    expect(updated).toEqual([]);
  });
});
