import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { organizations, platformAuditLogs } from "@/server/db/schema";
import { setTxSetting, withGlobalTx, withTenantTx, withUserTx } from "@/server/db/tx";
import { buildTenantContext, createSession, listUserOrganizations, resolveSession } from "@/server/modules/auth/service";
import { authenticateApiKey, createApiKey } from "@/server/modules/api-keys/service";
import { acceptInvitationWithNewAccount, createInvitation, getInvitationByToken } from "@/server/modules/invitations/service";
import { createProduct, listProducts } from "@/server/modules/catalog/service";
import { listStock } from "@/server/modules/inventory/service";
import { archiveCompany, listAllCompanies, listCompanyAccess, openCompanySupport, requirePlatformAdmin, restoreCompany, setCompanyPlan, type PlatformContext } from "@/server/modules/platform/service";
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
