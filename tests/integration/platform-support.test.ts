import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs, memberships, organizations, platformAuditLogs } from "@/server/db/schema";
import { setTxSetting, withGlobalTx, withTenantTx, withUserTx } from "@/server/db/tx";
import { buildTenantContext, createSession, listUserOrganizations, resolveSession } from "@/server/modules/auth/service";
import { authenticateApiKey, createApiKey, revokeApiKey } from "@/server/modules/api-keys/service";
import { acceptInvitationWithNewAccount, createInvitation, getInvitationByToken } from "@/server/modules/invitations/service";
import { randomUUID } from "node:crypto";
import { createProduct, listProducts } from "@/server/modules/catalog/service";
import { listStock } from "@/server/modules/inventory/service";
import { archiveCompany, changeCompanyOwner, joinCompanySupport, leaveCompanySupport, listAllCompanies, listCompanyAccess, openCompanySupport, requirePlatformAdmin, restoreCompany, setCompanyPlan, type PlatformContext } from "@/server/modules/platform/service";
import { listMembers, updateMember } from "@/server/modules/organizations/service";
import { listSales } from "@/server/modules/sales/service";
import { createOrg, createVariant, expectReject, grantPlatformAdmin, inviteNewMember, PASSWORD, type OrgFixture } from "./helpers";

async function platformAdmin(): Promise<PlatformContext> {
  const org = await createOrg("Operador soporte");
  await grantPlatformAdmin(org.owner.userId);
  const { token } = await createSession(org.owner.userId);
  return requirePlatformAdmin((await resolveSession(token))!, "203.0.113.9");
}

/** Contexto de plataforma de alguien que NO es administrador (nunca pasaría requirePlatformAdmin). */
const notAdmin = (org: OrgFixture): PlatformContext => ({ userId: org.owner.userId, ip: null, sessionCreatedAt: new Date() });

describe("acceso de soporte a todas las empresas", () => {
  it("el administrador lista todas las empresas, también las que no creó ni integra", async () => {
    const admin = await platformAdmin();
    const a = await createOrg("Empresa A soporte");
    await createVariant(a.owner);
    const rows = await listAllCompanies(admin);
    expect(rows.find((r) => r.organizationId === a.organizationId)).toMatchObject({ name: "Empresa A soporte", ownerEmail: a.email, members: 1, products: 1, ownerPending: false });
    // No queda como miembro de la empresa.
    expect((await listUserOrganizations(admin.userId)).map((o) => o.id)).not.toContain(a.organizationId);
  });

  it("quien no es administrador no puede listar ni abrir empresas", async () => {
    const a = await createOrg("Empresa propia");
    const b = await createOrg("Empresa ajena");
    await expectReject(listAllCompanies(notAdmin(a)), /NotFound/);
    await expectReject(openCompanySupport(notAdmin(a), b.organizationId, "products"), /NotFound/);
    await expectReject(listCompanyAccess(notAdmin(a), b.organizationId), /NotFound/);
  });

  it("la política de lectura exige ser administrador activo: fijar la variable no basta", async () => {
    const a = await createOrg("Sin privilegios");
    const b = await createOrg("Objetivo RLS");
    const names = await withGlobalTx(async (tx) => {
      await setTxSetting(tx, "app.platform_user_id", a.owner.userId);
      return tx.select({ id: organizations.id }).from(organizations);
    });
    expect(names.map((o) => o.id)).not.toContain(b.organizationId);
  });

  it("ser administrador no amplía lo que se ve dentro de una transacción normal", async () => {
    const admin = await platformAdmin();
    const other = await createOrg("Otra empresa RLS");
    // Con app.user_id de un administrador la política nueva no aplica: no hay fugas por consultas sin filtro.
    const asUser = await withUserTx(admin.userId, (tx) => tx.select({ id: organizations.id }).from(organizations));
    expect(asUser.map((o) => o.id)).not.toContain(other.organizationId);
    const own = (await listUserOrganizations(admin.userId))[0]!.id;
    const asTenant = await withTenantTx({ organizationId: own, userId: admin.userId }, (tx) => tx.select({ id: organizations.id }).from(organizations));
    expect(asTenant.map((o) => o.id)).not.toContain(other.organizationId);
  });

  it("abre la empresa en solo lectura, aislada de las demás, y sin poder escribir", async () => {
    const admin = await platformAdmin();
    const a = await createOrg("Soporte A");
    const b = await createOrg("Soporte B");
    const va = await createVariant(a.owner);
    const vb = await createVariant(b.owner);

    const { ctx, company } = await openCompanySupport(admin, a.organizationId, "products");
    expect(company.name).toBe("Soporte A");
    expect(ctx).toMatchObject({ organizationId: a.organizationId, role: "viewer" });

    const products = await listProducts(ctx);
    expect(products.rows.map((p) => p.id)).toEqual([va.productId]);
    expect(products.rows.map((p) => p.id)).not.toContain(vb.productId);
    expect((await listStock(ctx)).rows.map((r) => r.sku)).toEqual([va.sku]);
    expect((await listSales(ctx)).total).toBe(0);

    await expectReject(createProduct(ctx, { name: "No debe crearse", variants: [{ sku: "NO-1", costPrice: "1", salePrice: "2" }] }), /Forbidden/);
    expect((await listProducts(a.owner)).total).toBe(1);
  });

  it("cada apertura queda en la auditoría, con quién, qué empresa y qué sección", async () => {
    const admin = await platformAdmin();
    const a = await createOrg("Soporte auditado");
    await openCompanySupport(admin, a.organizationId, "sales");
    const logs = await withGlobalTx((tx) =>
      tx
        .select({ actor: platformAuditLogs.actorUserId, ip: platformAuditLogs.ip, data: platformAuditLogs.data })
        .from(platformAuditLogs)
        .where(sql`${platformAuditLogs.action} = 'platform.company_viewed' and ${platformAuditLogs.data} ->> 'organizationId' = ${a.organizationId}`),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actor: admin.userId, ip: "203.0.113.9", data: { organizationId: a.organizationId, name: "Soporte auditado", view: "sales" } });
    expect((await listCompanyAccess(admin, a.organizationId)).map((x) => x.actorName)).toHaveLength(1);
  });

  it("rechaza sesiones viejas, identificadores inválidos y empresas inexistentes", async () => {
    const admin = await platformAdmin();
    const a = await createOrg("Soporte sesión");
    const stale = { ...admin, sessionCreatedAt: new Date(Date.now() - 13 * 3_600_000) };
    await expectReject(openCompanySupport(stale, a.organizationId, "products"), /Forbidden/);
    await expectReject(listAllCompanies(stale), /Forbidden/);
    await expectReject(openCompanySupport(admin, "no-es-uuid", "products"), /NotFound/);
    await expectReject(openCompanySupport(admin, "00000000-0000-4000-8000-000000000000", "products"), /NotFound/);
  });

  it("una cuenta bloqueada pierde el acceso aunque siga en platform_admins", async () => {
    const admin = await platformAdmin();
    const a = await createOrg("Soporte bloqueo");
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    await c.connect();
    try {
      await c.query("update users set is_active = false, blocked_at = now(), blocked_reason = 'prueba' where id = $1", [admin.userId]);
    } finally {
      await c.end();
    }
    await expectReject(openCompanySupport(admin, a.organizationId, "products"), /NotFound/);
    const rows = await withGlobalTx((tx) => tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, a.organizationId)));
    expect(rows).toEqual([]);
  });

  it("cambia el plan con auditoría; quien no es administrador no puede", async () => {
    const admin = await platformAdmin();
    const a = await createOrg("Soporte plan");
    await setCompanyPlan(admin, a.organizationId, "pro");
    expect((await listAllCompanies(admin)).find((r) => r.organizationId === a.organizationId)?.plan).toBe("pro");
    // Sin cambio real no se audita de nuevo.
    await setCompanyPlan(admin, a.organizationId, "pro");
    const logs = await withGlobalTx((tx) =>
      tx
        .select({ data: platformAuditLogs.data })
        .from(platformAuditLogs)
        .where(sql`${platformAuditLogs.action} = 'platform.plan_changed' and ${platformAuditLogs.data} ->> 'organizationId' = ${a.organizationId}`),
    );
    expect(logs.map((l) => l.data)).toEqual([{ organizationId: a.organizationId, name: "Soporte plan", from: "free", to: "pro" }]);

    await expectReject(setCompanyPlan(admin, a.organizationId, "gratis-para-siempre"), /Validation/);
    await expectReject(setCompanyPlan(admin, "no-es-uuid", "pro"), /NotFound/);
    await expectReject(setCompanyPlan(notAdmin(a), a.organizationId, "enterprise"), /NotFound/);
    await expectReject(setCompanyPlan({ ...admin, sessionCreatedAt: new Date(Date.now() - 13 * 3_600_000) }, a.organizationId, "free"), /Forbidden/);
  });

  it("la lista trae último ingreso, variantes y ventas de 30 días de cada empresa, sin mezclarlas", async () => {
    const admin = await platformAdmin();
    const a = await createOrg("Métricas A");
    const b = await createOrg("Métricas B");
    await createVariant(a.owner);
    await createVariant(a.owner);
    const rows = await listAllCompanies(admin);
    expect(rows.find((r) => r.organizationId === a.organizationId)).toMatchObject({ products: 2, variants: 2, sales30d: 0 });
    expect(rows.find((r) => r.organizationId === b.organizationId)).toMatchObject({ products: 0, variants: 0, sales30d: 0 });
    // Sin ingreso ni sesión: nunca. Con sesión (p. ej. al aceptar una invitación) ya cuenta como actividad.
    expect(rows.find((r) => r.organizationId === a.organizationId)?.lastLoginAt).toBeNull();
    await createSession(a.owner.userId);
    const after = (await listAllCompanies(admin)).find((r) => r.organizationId === a.organizationId)?.lastLoginAt;
    expect(after).toBeInstanceOf(Date);
    expect(Date.now() - after!.getTime()).toBeLessThan(60_000);
  });
});

describe("eliminar y restaurar empresas", () => {
  /** Administrador que es el único miembro de su propia empresa. */
  async function adminWithOwnCompany() {
    const org = await createOrg("Solo mía");
    await grantPlatformAdmin(org.owner.userId);
    const { token } = await createSession(org.owner.userId);
    const admin = await requirePlatformAdmin((await resolveSession(token))!, null);
    return { org, admin };
  }

  it("una empresa solo tuya se elimina sin más; nadie entra, la clave deja de servir y restaurarla devuelve todo", async () => {
    const { org, admin } = await adminWithOwnCompany();
    const v = await createVariant(org.owner);
    const { key } = await createApiKey(org.owner, { name: "Tienda", scopes: ["catalog:read"] });
    await authenticateApiKey(`Bearer ${key}`);

    await archiveCompany(admin, org.organizationId);

    await expectReject(buildTenantContext(org.owner.userId, org.organizationId), /NotFound/);
    expect(await listUserOrganizations(org.owner.userId)).toEqual([]);
    await expectReject(authenticateApiKey(`Bearer ${key}`), /Unauthenticated/);
    expect((await listAllCompanies(admin)).find((c) => c.organizationId === org.organizationId)?.archivedAt).toBeInstanceOf(Date);

    await restoreCompany(admin, org.organizationId);

    const ctx = await buildTenantContext(org.owner.userId, org.organizationId);
    expect((await listProducts(ctx)).rows.map((p) => p.id)).toEqual([v.productId]);
    await authenticateApiKey(`Bearer ${key}`);
  });

  it("con otros usuarios exige el nombre exacto y un motivo, sin confiar en el formulario", async () => {
    const { org, admin } = await adminWithOwnCompany();
    await inviteNewMember(org.owner, "staff");

    await expectReject(archiveCompany(admin, org.organizationId), /Validation/);
    await expectReject(archiveCompany(admin, org.organizationId, { confirmName: "Otra", reason: "cierre del negocio" }), /Validation/);
    await expectReject(archiveCompany(admin, org.organizationId, { confirmName: "Solo mía" }), /Validation/);
    await buildTenantContext(org.owner.userId, org.organizationId); // sigue activa

    await archiveCompany(admin, org.organizationId, { confirmName: "Solo mía", reason: "cierre del negocio" });
    await expectReject(buildTenantContext(org.owner.userId, org.organizationId), /NotFound/);

    const logs = await withGlobalTx((tx) =>
      tx
        .select({ data: platformAuditLogs.data, actor: platformAuditLogs.actorUserId })
        .from(platformAuditLogs)
        .where(sql`${platformAuditLogs.action} = 'platform.company_archived' and ${platformAuditLogs.data} ->> 'organizationId' = ${org.organizationId}`),
    );
    expect(logs).toEqual([{ actor: admin.userId, data: { organizationId: org.organizationId, name: "Solo mía", otherMembers: 1, reason: "cierre del negocio" } }]);
  });

  it("una empresa de la que no eres miembro cuenta como ajena: exige más confirmación", async () => {
    const admin = await platformAdmin();
    const client = await createOrg("Cliente ajeno");
    await expectReject(archiveCompany(admin, client.organizationId), /Validation/);
    await archiveCompany(admin, client.organizationId, { confirmName: "Cliente ajeno", reason: "pidió cerrar la cuenta" });
    await expectReject(buildTenantContext(client.owner.userId, client.organizationId), /NotFound/);
  });

  it("no se aceptan invitaciones de una empresa eliminada", async () => {
    const { org, admin } = await adminWithOwnCompany();
    const { token } = await createInvitation(org.owner, { email: "nueva-eliminada@test.local", role: "staff" });
    await archiveCompany(admin, org.organizationId);
    expect((await getInvitationByToken(token)).state).toBe("revoked");
    await expectReject(acceptInvitationWithNewAccount(token, { name: "Nueva", password: PASSWORD }), /Conflict/);
  });

  it("solo un administrador con sesión reciente; no se elimina ni restaura dos veces", async () => {
    const { org, admin } = await adminWithOwnCompany();
    const other = await createOrg("Sin permisos");
    await expectReject(archiveCompany(notAdmin(other), org.organizationId), /NotFound/);
    await expectReject(archiveCompany({ ...admin, sessionCreatedAt: new Date(Date.now() - 13 * 3_600_000) }, org.organizationId), /Forbidden/);
    await expectReject(archiveCompany(admin, "no-es-uuid"), /NotFound/);
    await expectReject(restoreCompany(admin, org.organizationId), /Conflict/);
    await archiveCompany(admin, org.organizationId);
    await expectReject(archiveCompany(admin, org.organizationId), /Conflict/);
    await expectReject(restoreCompany(notAdmin(other), org.organizationId), /NotFound/);
  });

  it("no toca los datos de otras empresas", async () => {
    const { org, admin } = await adminWithOwnCompany();
    const other = await createOrg("Vecina");
    const v = await createVariant(other.owner);
    await archiveCompany(admin, org.organizationId);
    expect((await listProducts(other.owner)).rows.map((p) => p.id)).toEqual([v.productId]);
    await buildTenantContext(other.owner.userId, other.organizationId);
  });
});

describe("entrar a ayudar", () => {
  const REASON = "Montar el catálogo inicial";

  it("entra como administrador, puede editar y el cliente lo ve marcado como soporte", async () => {
    const admin = await platformAdmin();
    const client = await createOrg("Cliente ayuda");
    await expectReject(buildTenantContext(admin.userId, client.organizationId), /NotFound/);

    await joinCompanySupport(admin, client.organizationId, REASON);

    const ctx = await buildTenantContext(admin.userId, client.organizationId);
    expect(ctx).toMatchObject({ role: "admin", supportAccess: true });
    const v = await createVariant(ctx);
    expect((await listProducts(client.owner)).rows.map((p) => p.id)).toEqual([v.productId]);
    expect((await listMembers(client.owner)).find((m) => m.userId === admin.userId)).toMatchObject({ role: "admin", isSupport: true });
  });

  it("exige motivo y queda en la auditoría de la plataforma y en la de la empresa", async () => {
    const admin = await platformAdmin();
    const client = await createOrg("Cliente auditoría");
    await expectReject(joinCompanySupport(admin, client.organizationId, ""), /Validation/);
    await joinCompanySupport(admin, client.organizationId, REASON);
    const platform = await withGlobalTx((tx) =>
      tx
        .select({ data: platformAuditLogs.data })
        .from(platformAuditLogs)
        .where(sql`${platformAuditLogs.action} = 'platform.company_support_joined' and ${platformAuditLogs.data} ->> 'organizationId' = ${client.organizationId}`),
    );
    expect(platform.map((l) => l.data)).toEqual([{ organizationId: client.organizationId, name: "Cliente auditoría", reason: REASON }]);
    const tenant = await withTenantTx(client.owner, (tx) => tx.select({ action: auditLogs.action, actor: auditLogs.actorUserId }).from(auditLogs).where(eq(auditLogs.action, "support.joined")));
    expect(tenant).toEqual([{ action: "support.joined", actor: admin.userId }]);
  });

  it("no ocupa cupo, ni cuenta como usuario o actividad de la empresa, y no es la empresa activa al iniciar sesión", async () => {
    const admin = await platformAdmin();
    const client = await createOrg("Cliente cupo");
    await joinCompanySupport(admin, client.organizationId, REASON);
    const row = (await listAllCompanies(admin)).find((c) => c.organizationId === client.organizationId)!;
    expect(row).toMatchObject({ members: 1, otherMembers: 1, access: "support" });
    expect(row.lastLoginAt).toBeNull();
    // La cuenta sigue teniendo los 2 cupos libres del plan Gratis (3 usuarios): el soporte no gasta.
    await inviteNewMember(client.owner, "staff");
    await inviteNewMember(client.owner, "staff");
    await expectReject(inviteNewMember(client.owner, "staff"), /PlanLimit/);
    const orgs = await listUserOrganizations(admin.userId);
    expect(orgs.at(-1)).toMatchObject({ id: client.organizationId, isSupport: true });
    expect(orgs[0]?.isSupport).toBe(false);
  });

  it("si pierde el rol de administrador pierde el acceso, aunque siga la membresía", async () => {
    const admin = await platformAdmin();
    const client = await createOrg("Cliente rol");
    await joinCompanySupport(admin, client.organizationId, REASON);
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    await c.connect();
    try {
      await c.query("delete from platform_admins where user_id = $1", [admin.userId]);
    } finally {
      await c.end();
    }
    await expectReject(buildTenantContext(admin.userId, client.organizationId), /NotFound/);
  });

  it("si el cliente lo desactiva, se respeta: no puede entrar ni volver a unirse", async () => {
    const admin = await platformAdmin();
    const client = await createOrg("Cliente desactiva");
    await joinCompanySupport(admin, client.organizationId, REASON);
    await updateMember(client.owner, admin.userId, { role: "admin", status: "disabled" });
    await expectReject(buildTenantContext(admin.userId, client.organizationId), /Forbidden/);
    await expectReject(joinCompanySupport(admin, client.organizationId, REASON), /Forbidden/);
  });

  it("al salir deja de ser miembro y lo que hizo se conserva", async () => {
    const admin = await platformAdmin();
    const client = await createOrg("Cliente salida");
    await joinCompanySupport(admin, client.organizationId, REASON);
    const v = await createVariant(await buildTenantContext(admin.userId, client.organizationId));
    await leaveCompanySupport(admin, client.organizationId);
    await expectReject(buildTenantContext(admin.userId, client.organizationId), /NotFound/);
    expect((await listProducts(client.owner)).rows.map((p) => p.id)).toEqual([v.productId]);
    expect((await listMembers(client.owner)).map((m) => m.userId)).not.toContain(admin.userId);
    await expectReject(leaveCompanySupport(admin, client.organizationId), /NotFound/);
  });

  it("no deja salir si hay claves o invitaciones suyas que dejarían de funcionar", async () => {
    const admin = await platformAdmin();
    const client = await createOrg("Cliente claves");
    await joinCompanySupport(admin, client.organizationId, REASON);
    const ctx = await buildTenantContext(admin.userId, client.organizationId);
    const { id } = await createApiKey(ctx, { name: "Tienda", scopes: ["catalog:read"] });
    await expectReject(leaveCompanySupport(admin, client.organizationId), /Conflict/);
    await revokeApiKey(ctx, id);
    await leaveCompanySupport(admin, client.organizationId);
  });

  it("nunca convierte ni borra una membresía real; solo administradores; no en empresas eliminadas", async () => {
    const org = await createOrg("Propia real");
    await grantPlatformAdmin(org.owner.userId);
    const { token } = await createSession(org.owner.userId);
    const admin = await requirePlatformAdmin((await resolveSession(token))!, null);
    await expectReject(joinCompanySupport(admin, org.organizationId, REASON), /Conflict/);
    await expectReject(leaveCompanySupport(admin, org.organizationId), /NotFound/);
    const [m] = await withTenantTx(org.owner, (tx) => tx.select({ role: memberships.role, isSupport: memberships.isSupport }).from(memberships).where(eq(memberships.userId, org.owner.userId)));
    expect(m).toEqual({ role: "owner", isSupport: false });

    const client = await createOrg("Cliente ajeno ayuda");
    const other = await createOrg("Sin rol");
    await expectReject(joinCompanySupport(notAdmin(other), client.organizationId, REASON), /NotFound/);
    await expectReject(joinCompanySupport({ ...admin, sessionCreatedAt: new Date(Date.now() - 13 * 3_600_000) }, client.organizationId, REASON), /Forbidden/);
    await archiveCompany(admin, client.organizationId, { confirmName: "Cliente ajeno ayuda", reason: "prueba" });
    await expectReject(joinCompanySupport(admin, client.organizationId, REASON), /Conflict/);
  });
});

describe("cambiar el dueño de una empresa", () => {
  const roleOf = async (org: OrgFixture, userId: string) => (await listMembers(org.owner)).find((m) => m.userId === userId)?.role;
  const REASON = "Se vendió el negocio";

  it("a un miembro activo: inmediato, y el anterior queda como administrador con sus claves funcionando", async () => {
    const admin = await platformAdmin();
    const org = await createOrg("Dueño inmediato");
    const { key } = await createApiKey(org.owner, { name: "Tienda", scopes: ["catalog:read"] });
    const member = await inviteNewMember(org.owner, "manager");

    expect(await changeCompanyOwner(admin, org.organizationId, { email: member.email, confirmName: "Dueño inmediato", reason: REASON })).toEqual({ status: "changed" });

    expect((await buildTenantContext(member.userId, org.organizationId)).role).toBe("owner");
    expect((await buildTenantContext(org.owner.userId, org.organizationId)).role).toBe("admin");
    await authenticateApiKey(`Bearer ${key}`);
    const logs = await withGlobalTx((tx) =>
      tx
        .select({ target: platformAuditLogs.targetUserId, data: platformAuditLogs.data })
        .from(platformAuditLogs)
        .where(sql`${platformAuditLogs.action} = 'platform.owner_changed' and ${platformAuditLogs.data} ->> 'organizationId' = ${org.organizationId}`),
    );
    expect(logs).toEqual([{ target: member.userId, data: { organizationId: org.organizationId, name: "Dueño inmediato", formerOwners: [org.owner.userId], reason: REASON } }]);
    const tenant = await withTenantTx({ organizationId: org.organizationId, userId: member.userId }, (tx) => tx.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.action, "owner.changed")));
    expect(tenant).toHaveLength(1);
  });

  it("a alguien externo: por enlace; nada cambia hasta que acepta y entonces queda como único dueño", async () => {
    const admin = await platformAdmin();
    const org = await createOrg("Dueño externo");
    const email = `nuevo-${randomUUID()}@test.local`;

    const r = await changeCompanyOwner(admin, org.organizationId, { email, confirmName: "Dueño externo", reason: REASON });
    expect(r).toMatchObject({ status: "invited", email });
    expect(await roleOf(org, org.owner.userId)).toBe("owner");
    expect((await listAllCompanies(admin)).find((c) => c.organizationId === org.organizationId)).toMatchObject({ ownerEmail: org.email, pendingOwnerEmail: email });

    const { userId } = await acceptInvitationWithNewAccount((r as { token: string }).token, { name: "Nueva dueña", password: PASSWORD });
    expect((await buildTenantContext(userId, org.organizationId)).role).toBe("owner");
    expect((await buildTenantContext(org.owner.userId, org.organizationId)).role).toBe("admin");
    expect((await listAllCompanies(admin)).find((c) => c.organizationId === org.organizationId)).toMatchObject({ ownerEmail: email, pendingOwnerEmail: null });
  });

  it("una solicitud nueva anula el enlace anterior", async () => {
    const admin = await platformAdmin();
    const org = await createOrg("Dueño doble");
    const first = await changeCompanyOwner(admin, org.organizationId, { email: `a-${randomUUID()}@test.local`, confirmName: "Dueño doble", reason: REASON });
    await changeCompanyOwner(admin, org.organizationId, { email: `b-${randomUUID()}@test.local`, confirmName: "Dueño doble", reason: REASON });
    await expectReject(acceptInvitationWithNewAccount((first as { token: string }).token, { name: "Tarde", password: PASSWORD }), /Conflict/);
    expect(await roleOf(org, org.owner.userId)).toBe("owner");
  });

  it("exige nombre exacto y motivo, y rechaza a quien no puede ser dueño", async () => {
    const admin = await platformAdmin();
    const org = await createOrg("Dueño reglas");
    const member = await inviteNewMember(org.owner, "staff");
    await expectReject(changeCompanyOwner(admin, org.organizationId, { email: member.email, confirmName: "Otra", reason: REASON }), /Validation/);
    await expectReject(changeCompanyOwner(admin, org.organizationId, { email: member.email, confirmName: "Dueño reglas", reason: "" }), /Validation/);
    await expectReject(changeCompanyOwner(admin, org.organizationId, { email: "no-es-correo", confirmName: "Dueño reglas", reason: REASON }), /Validation/);
    await expectReject(changeCompanyOwner(admin, org.organizationId, { email: org.email, confirmName: "Dueño reglas", reason: REASON }), /Conflict/);
    await updateMember(org.owner, member.userId, { role: "staff", status: "disabled" });
    await expectReject(changeCompanyOwner(admin, org.organizationId, { email: member.email, confirmName: "Dueño reglas", reason: REASON }), /Conflict/);
    expect(await roleOf(org, org.owner.userId)).toBe("owner");
  });

  it("no hace dueño a una cuenta de soporte; solo administradores; no en empresas eliminadas ni sobre el límite del plan", async () => {
    const admin = await platformAdmin();
    const org = await createOrg("Dueño límites");
    const { rows } = { rows: await listAllCompanies(admin) };
    const adminEmail = rows.find((c) => c.access === "member")?.ownerEmail ?? "";
    await joinCompanySupport(admin, org.organizationId, "Montar la cuenta");
    await expectReject(changeCompanyOwner(admin, org.organizationId, { email: adminEmail, confirmName: "Dueño límites", reason: REASON }), /Conflict/);
    await leaveCompanySupport(admin, org.organizationId);

    const other = await createOrg("Sin rol dueño");
    await expectReject(changeCompanyOwner(notAdmin(other), org.organizationId, { email: other.email, confirmName: "Dueño límites", reason: REASON }), /NotFound/);
    await expectReject(changeCompanyOwner({ ...admin, sessionCreatedAt: new Date(Date.now() - 13 * 3_600_000) }, org.organizationId, { email: other.email, confirmName: "Dueño límites", reason: REASON }), /Forbidden/);

    // Plan Gratis: 3 usuarios. Con el cupo lleno no se emite un enlace que luego fallaría.
    await inviteNewMember(org.owner, "staff");
    await inviteNewMember(org.owner, "staff");
    await expectReject(changeCompanyOwner(admin, org.organizationId, { email: `lleno-${randomUUID()}@test.local`, confirmName: "Dueño límites", reason: REASON }), /PlanLimit/);

    await archiveCompany(admin, org.organizationId, { confirmName: "Dueño límites", reason: "prueba" });
    await expectReject(changeCompanyOwner(admin, org.organizationId, { email: other.email, confirmName: "Dueño límites", reason: REASON }), /Conflict/);
  });

  it("no afecta a otras empresas", async () => {
    const admin = await platformAdmin();
    const a = await createOrg("Dueño A");
    const b = await createOrg("Dueño B");
    const member = await inviteNewMember(a.owner, "admin");
    await changeCompanyOwner(admin, a.organizationId, { email: member.email, confirmName: "Dueño A", reason: REASON });
    expect((await buildTenantContext(b.owner.userId, b.organizationId)).role).toBe("owner");
  });
});
