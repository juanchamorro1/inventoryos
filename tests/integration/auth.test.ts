import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authenticate,
  buildTenantContext,
  changePassword,
  createSession,
  listUserOrganizations,
  registerOwner,
  resolveSession,
} from "@/server/modules/auth/service";
import { addMember, listMembers, updateMember } from "@/server/modules/organizations/service";
import { createOrg, expectReject, PASSWORD } from "./helpers";

describe("autenticación y sesiones", () => {
  it("registra un propietario con empresa, bodega e impuestos por defecto", async () => {
    const org = await createOrg("Celulares Norte");
    expect(org.owner.role).toBe("owner");
    expect(org.locationId).toBeTruthy();
  });

  it("rechaza correos repetidos y contraseñas débiles", async () => {
    const email = `dup-${randomUUID()}@test.local`;
    await registerOwner({ name: "A", email, password: PASSWORD, organizationName: "Uno" }).catch(() => {});
    await registerOwner({ name: "Ana", email, password: PASSWORD, organizationName: "Uno" }).catch(() => {});
    await expectReject(registerOwner({ name: "Ana", email: email.toUpperCase(), password: PASSWORD, organizationName: "Dos" }), "ValidationError");
    await expectReject(registerOwner({ name: "Ana", email: `w-${randomUUID()}@test.local`, password: "123", organizationName: "Dos" }), "ValidationError");
  });

  it("inicia sesión, resuelve la sesión y rechaza credenciales inválidas con mensaje genérico", async () => {
    const org = await createOrg();
    const userId = await authenticate(org.email, PASSWORD, "10.0.0.1");
    expect(userId).toBe(org.owner.userId);
    const { token } = await createSession(userId, { ip: "10.0.0.1" });
    const session = await resolveSession(token);
    expect(session?.user.id).toBe(userId);
    expect(session?.activeOrganizationId).toBe(org.organizationId);
    expect(await resolveSession("token-falso")).toBeNull();
    const err = await expectReject(authenticate(org.email, "incorrecta-123", "10.0.0.1"), "UnauthenticatedError");
    expect(err.message).toBe("Correo o contraseña incorrectos.");
    await expectReject(authenticate("noexiste@test.local", PASSWORD, "10.0.0.1"), "UnauthenticatedError");
  });

  it("bloquea por exceso de intentos fallidos", async () => {
    const org = await createOrg();
    for (let i = 0; i < 5; i++) await authenticate(org.email, "mala-clave-1", "10.0.0.2").catch(() => {});
    await expectReject(authenticate(org.email, PASSWORD, "10.0.0.2"), "RateLimitError");
  });

  it("cambiar la contraseña cierra las demás sesiones", async () => {
    const org = await createOrg();
    const a = await createSession(org.owner.userId);
    const b = await createSession(org.owner.userId);
    const sa = await resolveSession(a.token);
    await changePassword(org.owner.userId, PASSWORD, "NuevaClave2027", sa!.tokenHash);
    expect(await resolveSession(a.token)).not.toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
    await expectReject(authenticate(org.email, PASSWORD, null), "UnauthenticatedError");
  });
});

describe("miembros y roles", () => {
  it("agrega miembros, respeta jerarquía de roles y conserva un propietario", async () => {
    const org = await createOrg();
    const { userId } = await addMember(org.owner, { email: `m-${randomUUID()}@test.local`, name: "Marta", role: "manager", password: PASSWORD });
    const manager = await buildTenantContext(userId, org.organizationId);
    await expectReject(listMembers(manager), "ForbiddenError");
    const members = await listMembers(org.owner);
    expect(members.map((m) => m.role).sort()).toEqual(["manager", "owner"]);
    await expectReject(updateMember(org.owner, org.owner.userId, { role: "viewer", status: "active" }), "ForbiddenError");

    const { userId: adminId } = await addMember(org.owner, { email: `a-${randomUUID()}@test.local`, name: "Admin", role: "admin", password: PASSWORD });
    const admin = await buildTenantContext(adminId, org.organizationId);
    await expectReject(updateMember(admin, org.owner.userId, { role: "viewer", status: "active" }), "ForbiddenError");
    await expectReject(addMember(admin, { email: `o-${randomUUID()}@test.local`, name: "Otro", role: "owner", password: PASSWORD }), "ForbiddenError");
  });

  it("un miembro desactivado pierde el acceso", async () => {
    const org = await createOrg();
    const { userId } = await addMember(org.owner, { email: `s-${randomUUID()}@test.local`, name: "Sara", role: "staff", password: PASSWORD });
    await updateMember(org.owner, userId, { role: "staff", status: "disabled" });
    await expectReject(buildTenantContext(userId, org.organizationId), "ForbiddenError");
    expect(await listUserOrganizations(userId)).toEqual([]);
  });

  it("respeta el límite de usuarios del plan gratuito", async () => {
    const org = await createOrg();
    await addMember(org.owner, { email: `p1-${randomUUID()}@test.local`, name: "Uno", role: "viewer", password: PASSWORD });
    await addMember(org.owner, { email: `p2-${randomUUID()}@test.local`, name: "Dos", role: "viewer", password: PASSWORD });
    await expectReject(addMember(org.owner, { email: `p3-${randomUUID()}@test.local`, name: "Tres", role: "viewer", password: PASSWORD }), "PlanLimitError");
  });
});
