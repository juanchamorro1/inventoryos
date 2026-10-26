import type { Role } from "../db/schema";
import type { TenantContext } from "./context";
import { ForbiddenError } from "./errors";

export const PERMISSIONS = [
  "catalog.read",
  "catalog.write",
  "inventory.read",
  "inventory.write",
  "purchasing.read",
  "purchasing.write",
  "purchasing.receive",
  "sales.read",
  "sales.write",
  "sales.manage",
  "reports.read",
  "members.manage",
  "settings.manage",
  "apikeys.manage",
  "audit.read",
  // Configurar márgenes y tasas, fijar precios manuales y aprobar cambios de precios.
  "pricing.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ: Permission[] = ["catalog.read", "inventory.read", "purchasing.read", "sales.read", "reports.read"];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set(PERMISSIONS),
  manager: new Set<Permission>([
    ...READ,
    "catalog.write",
    "inventory.write",
    "purchasing.write",
    "purchasing.receive",
    "sales.write",
    "sales.manage",
    "audit.read",
    "pricing.manage",
  ]),
  // Personal de tienda: vende, recibe mercancía y consulta.
  staff: new Set<Permission>(["catalog.read", "inventory.read", "purchasing.read", "purchasing.receive", "sales.read", "sales.write"]),
  viewer: new Set<Permission>(READ),
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Gerente",
  staff: "Vendedor / Bodega",
  viewer: "Solo lectura",
};

/** Alcances que puede tener una clave API (siempre de solo lectura en esta versión). */
export const API_SCOPES = ["catalog:read", "inventory:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function can(ctx: Pick<TenantContext, "role" | "actor">, permission: Permission): boolean {
  if (ctx.actor.type === "api_key") {
    // Las claves API solo leen catálogo y disponibilidad.
    if (permission === "catalog.read") return ctx.actor.scopes.includes("catalog:read");
    if (permission === "inventory.read") return ctx.actor.scopes.includes("inventory:read");
    return false;
  }
  return MATRIX[ctx.role].has(permission);
}

export function requirePermission(ctx: Pick<TenantContext, "role" | "actor">, permission: Permission) {
  if (!can(ctx, permission)) throw new ForbiddenError();
}

/** Un usuario solo puede asignar roles de nivel igual o inferior al suyo; nadie asigna "owner" salvo otro owner. */
const RANK: Record<Role, number> = { owner: 5, admin: 4, manager: 3, staff: 2, viewer: 1 };
export const canAssignRole = (actor: Role, target: Role) => RANK[actor] >= RANK[target] && (target !== "owner" || actor === "owner");
