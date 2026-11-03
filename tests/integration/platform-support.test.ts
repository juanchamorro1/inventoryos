import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { organizations, platformAuditLogs } from "@/server/db/schema";
import { setTxSetting, withGlobalTx, withTenantTx, withUserTx } from "@/server/db/tx";
import { createSession, listUserOrganizations, resolveSession } from "@/server/modules/auth/service";
import { createProduct, listProducts } from "@/server/modules/catalog/service";
import { listStock } from "@/server/modules/inventory/service";
import { listAllCompanies, listCompanyAccess, openCompanySupport, requirePlatformAdmin, type PlatformContext } from "@/server/modules/platform/service";
import { listSales } from "@/server/modules/sales/service";
import { createOrg, createVariant, expectReject, grantPlatformAdmin, type OrgFixture } from "./helpers";

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
});
