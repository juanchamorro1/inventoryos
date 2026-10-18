import "server-only";
import { notFound, redirect } from "next/navigation";
import type { TenantContext } from "../platform/context";
import { ForbiddenError, NotFoundError } from "../platform/errors";
import { can, type Permission } from "../platform/permissions";

/** En páginas: convierte NotFound en 404 y Forbidden en la página /forbidden. */
export async function load<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ForbiddenError) redirect("/forbidden");
    throw err;
  }
}

export function requirePagePermission(ctx: TenantContext, permission: Permission) {
  if (!can(ctx, permission)) redirect("/forbidden");
}
