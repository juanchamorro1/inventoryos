import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { buildTenantContext, deleteSession, resolveSession, SESSION_TTL_DAYS, type SessionInfo } from "../modules/auth/service";
import type { TenantContext } from "../platform/context";
import { AppError } from "../platform/errors";
import { env } from "../env";

export const SESSION_COOKIE = "ios_session";

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure siempre que la app se sirva por HTTPS (obligatorio en producción).
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export async function clearSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  store.delete(SESSION_COOKIE);
}

/** Borra solo la cookie (cuando las sesiones ya se eliminaron en la base). */
export async function dropSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(token);
});

export async function requestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}

/** Para páginas: redirige a /login o a /organizations si falta sesión o empresa activa. */
export const requireContext = cache(async (): Promise<{ ctx: TenantContext; session: SessionInfo }> => {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.activeOrganizationId) redirect("/organizations");
  try {
    const ctx = await buildTenantContext(session.user.id, session.activeOrganizationId);
    return { ctx, session };
  } catch (err) {
    if (err instanceof AppError) redirect("/organizations");
    throw err;
  }
});

/** Para server actions: lanza error en lugar de redirigir. */
export async function actionContext(): Promise<{ ctx: TenantContext; session: SessionInfo }> {
  const session = await getSession();
  if (!session || !session.activeOrganizationId) {
    const { UnauthenticatedError } = await import("../platform/errors");
    throw new UnauthenticatedError("Tu sesión expiró. Inicia sesión de nuevo.");
  }
  const ctx = await buildTenantContext(session.user.id, session.activeOrganizationId);
  return { ctx, session };
}
