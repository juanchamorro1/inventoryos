import { and, count, eq, gt, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { invitations, memberships, organizations, productVariants, warehouses } from "../db/schema";
import { PlanLimitError } from "./errors";

// Planes comerciales y sus límites. No hay cobro integrado: el plan se asigna por script
// (scripts/set-plan.ts) hasta que exista un proveedor de pagos.
export const PLANS = {
  free: { label: "Gratis", maxUsers: 3, maxWarehouses: 2, maxVariants: 500 },
  pro: { label: "Profesional", maxUsers: 25, maxWarehouses: 20, maxVariants: 20_000 },
  enterprise: { label: "Empresarial", maxUsers: Infinity, maxWarehouses: Infinity, maxVariants: Infinity },
} as const;
export type PlanId = keyof typeof PLANS;

type Resource = "users" | "warehouses" | "variants";

async function planOf(tx: Tx, organizationId: string): Promise<PlanId> {
  const [org] = await tx.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, organizationId));
  return (org?.plan ?? "free") as PlanId;
}

/** Verifica dentro de la transacción que agregar `adding` elementos no excede el plan. */
export async function assertWithinPlan(tx: Tx, organizationId: string, resource: Resource, adding = 1) {
  const plan = PLANS[await planOf(tx, organizationId)];
  const [row] =
    resource === "users"
      ? await tx.select({ n: count() }).from(memberships).where(eq(memberships.organizationId, organizationId))
      : resource === "warehouses"
        ? await tx.select({ n: count() }).from(warehouses).where(eq(warehouses.organizationId, organizationId))
        : await tx.select({ n: count() }).from(productVariants).where(eq(productVariants.organizationId, organizationId));
  // Cada invitación pendiente y vigente reserva un cupo de usuario.
  const [pending] =
    resource === "users"
      ? await tx
          .select({ n: count() })
          .from(invitations)
          .where(and(eq(invitations.organizationId, organizationId), eq(invitations.status, "pending"), gt(invitations.expiresAt, sql`now()`)))
      : [{ n: 0 }];
  const current = (row?.n ?? 0) + (pending?.n ?? 0);
  const max = resource === "users" ? plan.maxUsers : resource === "warehouses" ? plan.maxWarehouses : plan.maxVariants;
  if (current + adding > max) {
    const label = resource === "users" ? "usuarios" : resource === "warehouses" ? "bodegas" : "variantes de producto";
    throw new PlanLimitError(`Tu plan ${plan.label} permite hasta ${max} ${label}. Actualiza el plan para agregar más.`);
  }
}
