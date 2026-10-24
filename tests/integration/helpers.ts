import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll } from "vitest";
import { closeDb } from "@/server/db/client";
import { locations, warehouses, type Role } from "@/server/db/schema";
import { withTenantTx } from "@/server/db/tx";
import { buildTenantContext, registerOwner } from "@/server/modules/auth/service";
import { createProduct } from "@/server/modules/catalog/service";
import { acceptInvitationWithNewAccount, createInvitation } from "@/server/modules/invitations/service";
import type { TenantContext } from "@/server/platform/context";
import { pgError } from "@/server/platform/errors";

afterAll(async () => {
  await closeDb();
});

export const PASSWORD = "ClaveSegura2026";

export type OrgFixture = {
  owner: TenantContext;
  organizationId: string;
  warehouseId: string;
  locationId: string;
  email: string;
};

export async function createOrg(name = "Empresa de prueba"): Promise<OrgFixture> {
  const email = `owner-${randomUUID()}@test.local`;
  const { userId, organizationId } = await registerOwner({ name: "Dueño", email, password: PASSWORD, organizationName: name });
  const owner = await buildTenantContext(userId, organizationId);
  const [loc] = await withTenantTx(owner, (tx) =>
    tx
      .select({ locationId: locations.id, warehouseId: warehouses.id })
      .from(locations)
      .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
      .where(and(eq(warehouses.isDefault, true), eq(locations.isDefault, true))),
  );
  return { owner, organizationId, warehouseId: loc!.warehouseId, locationId: loc!.locationId, email };
}

/** Invita a una persona nueva y acepta la invitación creando su cuenta (flujo real de alta de miembros). */
export async function inviteNewMember(inviter: TenantContext, role: Role, email = `${role}-${randomUUID()}@test.local`) {
  const { token } = await createInvitation(inviter, { email, role });
  const { userId } = await acceptInvitationWithNewAccount(token, { name: `Usuario ${role}`, password: PASSWORD });
  return { userId, email };
}

export async function memberCtx(org: OrgFixture, role: Role): Promise<TenantContext> {
  const { userId } = await inviteNewMember(org.owner, role);
  return buildTenantContext(userId, org.organizationId);
}

let skuCounter = 0;
export async function createVariant(ctx: TenantContext, opts: { sku?: string; price?: string; cost?: string; threshold?: string } = {}) {
  const sku = opts.sku ?? `SKU-${Date.now().toString(36)}-${++skuCounter}`;
  const productId = await createProduct(ctx, {
    name: `Producto ${sku}`,
    variants: [{ sku, costPrice: opts.cost ?? "100", salePrice: opts.price ?? "200", lowStockThreshold: opts.threshold ?? "0" }],
  });
  const { getProduct } = await import("@/server/modules/catalog/service");
  const p = await getProduct(ctx, productId!);
  return { productId: productId!, variantId: p.variants[0]!.id, sku };
}

export async function expectReject(promise: Promise<unknown>, name: string | RegExp) {
  try {
    await promise;
  } catch (err) {
    const e = err as Error;
    const matches = typeof name === "string" ? e.name === name : name.test(`${e.name}: ${e.message}`);
    if (!matches) throw new Error(`Se esperaba ${String(name)} pero se obtuvo ${e.name}: ${e.message}`);
    return e;
  }
  throw new Error(`Se esperaba un error ${String(name)} pero la operación tuvo éxito.`);
}

/** Espera un error de PostgreSQL con el código SQLSTATE indicado (p. ej. 42501 RLS, 23503 FK). */
export async function expectPgError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    const actual = pgError(err)?.code;
    if (actual !== code) throw new Error(`Se esperaba SQLSTATE ${code} pero se obtuvo ${actual ?? (err as Error).message}`);
    return;
  }
  throw new Error(`Se esperaba SQLSTATE ${code} pero la operación tuvo éxito.`);
}
