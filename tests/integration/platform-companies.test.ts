import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { categories, organizations } from "@/server/db/schema";
import { withTenantTx } from "@/server/db/tx";
import { buildTenantContext, createSession, listUserOrganizations, resolveSession } from "@/server/modules/auth/service";
import { acceptInvitation, acceptInvitationWithNewAccount, createInvitation, getInvitationByToken } from "@/server/modules/invitations/service";
import { setBusinessType } from "@/server/modules/organizations/service";
import { createCompany, listCompanies, reissueOwnerInvitation, requirePlatformAdmin, type PlatformContext } from "@/server/modules/platform/service";
import { getPricingOverview } from "@/server/modules/pricing/service";
import { BUSINESS_PROFILES } from "@/server/platform/business-types";
import { createOrg, expectReject, grantPlatformAdmin, memberCtx, PASSWORD } from "./helpers";

async function platformAdmin(): Promise<PlatformContext> {
  const org = await createOrg("Operador empresas");
  await grantPlatformAdmin(org.owner.userId);
  const { token } = await createSession(org.owner.userId);
  return requirePlatformAdmin((await resolveSession(token))!, null);
}

const email = () => `dueno-${randomUUID()}@test.local`;

async function categoriesOf(orgId: string, userId: string) {
  return withTenantTx({ organizationId: orgId, userId }, (tx) => tx.select({ name: categories.name }).from(categories));
}

describe("empresas creadas desde la plataforma", () => {
  it("crea una empresa de cosmética con su configuración y el dueño la administra al aceptar", async () => {
    const admin = await platformAdmin();
    const owner = email();
    const { organizationId, token } = await createCompany(admin, { name: "Barriera Cosméticos", businessType: "cosmetics", ownerEmail: owner, currency: "COP" });

    // Sin miembros hasta que el dueño acepte; la plataforma no queda como miembro.
    expect(await listUserOrganizations(admin.userId)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: organizationId })]));
    const listed = (await listCompanies(admin)).find((c) => c.organizationId === organizationId);
    expect(listed).toMatchObject({ name: "Barriera Cosméticos", businessType: "cosmetics", ownerEmail: owner, members: 0, ownerPending: true });
    expect(await getInvitationByToken(token)).toMatchObject({ organizationName: "Barriera Cosméticos", role: "owner", state: "valid", accountExists: false });

    const { userId } = await acceptInvitationWithNewAccount(token, { name: "Dueña Barriera", password: PASSWORD });
    const ctx = await buildTenantContext(userId, organizationId);
    expect(ctx.role).toBe("owner");
    const [org] = await withTenantTx(ctx, (tx) => tx.select({ businessType: organizations.businessType }).from(organizations).where(eq(organizations.id, organizationId)));
    expect(org!.businessType).toBe("cosmetics");
    expect((await categoriesOf(organizationId, userId)).map((c) => c.name).sort()).toEqual([...BUSINESS_PROFILES.cosmetics.categories].sort());
    // Precios automáticos y mayorista apagados para no confundir.
    expect((await getPricingOverview(ctx)).settings).toMatchObject({ retailAutoEnabled: false, wholesaleEnabled: false });
    // El dueño invita a su equipo normalmente.
    const { token: staffToken } = await createInvitation(ctx, { email: email(), role: "staff" });
    await acceptInvitationWithNewAccount(staffToken, { name: "Vendedora", password: PASSWORD });
    expect((await listCompanies(admin)).find((c) => c.organizationId === organizationId)).toMatchObject({ members: 2, ownerPending: false });
  });

  it("una cuenta existente acepta con su sesión; nuevo enlace anula el anterior y no se reenvía con dueño", async () => {
    const admin = await platformAdmin();
    const existing = await createOrg("Ya tengo cuenta");
    const first = await createCompany(admin, { name: "Segunda empresa", businessType: "electronics", ownerEmail: existing.email });
    const again = await reissueOwnerInvitation(admin, first.organizationId);
    expect(again.email).toBe(existing.email);
    expect((await getInvitationByToken(first.token)).state).toBe("revoked");
    await acceptInvitation(again.token, existing.owner.userId);
    expect((await listUserOrganizations(existing.owner.userId)).map((o) => o.role)).toEqual(expect.arrayContaining(["owner", "owner"]));
    await expectReject(reissueOwnerInvitation(admin, first.organizationId), /ya tiene propietario/);
    await expectReject(reissueOwnerInvitation(admin, existing.organizationId), /creadas desde la plataforma/);
  });

  it("si al emisor le retiran el rol de plataforma, su invitación deja de servir", async () => {
    const admin = await platformAdmin();
    const { token } = await createCompany(admin, { name: "Sin emisor", businessType: "general", ownerEmail: email() });
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    await c.connect();
    await c.query("delete from platform_admins where user_id = $1", [admin.userId]);
    await c.end();
    await expectReject(acceptInvitationWithNewAccount(token, { name: "Tarde", password: PASSWORD }), /ya no es válida/);
  });

  it("solo un administrador de plataforma crea empresas y valida los datos", async () => {
    const org = await createOrg("No soy plataforma");
    const forged: PlatformContext = { userId: org.owner.userId, ip: null, sessionCreatedAt: new Date() };
    await expectReject(createCompany(forged, { name: "Pirata", businessType: "general", ownerEmail: email() }), "NotFoundError");
    await expectReject(listCompanies(forged), "NotFoundError");
    const admin = await platformAdmin();
    await expectReject(createCompany(admin, { name: "X", businessType: "general", ownerEmail: email() }), "ValidationError");
    await expectReject(createCompany(admin, { name: "Bien", businessType: "panaderia", ownerEmail: email() }), "ValidationError");
    await expectReject(createCompany(admin, { name: "Bien", businessType: "general", ownerEmail: "no-es-correo" }), "ValidationError");
  });
});

describe("tipo de negocio", () => {
  it("cambiarlo crea las categorías que faltan sin duplicar ni borrar, y opcionalmente ajusta precios", async () => {
    const org = await createOrg("Cambia de tipo");
    await withTenantTx(org.owner, (tx) => tx.insert(categories).values({ organizationId: org.organizationId, name: "cremas" }));
    const r = await setBusinessType(org.owner, { businessType: "cosmetics", applyPricing: false });
    expect(r.categoriesCreated).toBe(BUSINESS_PROFILES.cosmetics.categories.length - 1);
    const names = (await categoriesOf(org.organizationId, org.owner.userId)).map((c) => c.name.toLowerCase());
    expect(names.filter((n) => n === "cremas")).toHaveLength(1);
    expect((await getPricingOverview(org.owner)).settings.retailAutoEnabled).toBe(true);
    expect((await setBusinessType(org.owner, { businessType: "cosmetics", applyPricing: true })).categoriesCreated).toBe(0);
    expect((await getPricingOverview(org.owner)).settings).toMatchObject({ retailAutoEnabled: false, wholesaleEnabled: false });

    const staff = await memberCtx(org, "staff");
    await expectReject(setBusinessType(staff, { businessType: "general" }), "ForbiddenError");
    await expectReject(setBusinessType(org.owner, { businessType: "panaderia" }), "ValidationError");
  });
});
