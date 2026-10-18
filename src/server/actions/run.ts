import "server-only";
import { actionContext } from "../auth/session";
import type { TenantContext } from "../platform/context";
import { AppError, ValidationError } from "../platform/errors";
import type { SessionInfo } from "../modules/auth/service";

import type { ActionState } from "@/lib/action-state";
export type { ActionState };

/** Traduce errores de dominio a un estado serializable; los errores inesperados se registran y se ocultan. */
export function toErrorState(err: unknown): ActionState {
  if (err instanceof ValidationError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors, at: Date.now() };
  if (err instanceof AppError) return { ok: false, error: err.message, at: Date.now() };
  console.error("[action] error inesperado", err);
  return { ok: false, error: "Ocurrió un error inesperado. Inténtalo de nuevo; si persiste, contacta al administrador.", at: Date.now() };
}

/** Ejecuta una acción con el contexto de empresa de la sesión. Las redirecciones deben hacerse fuera. */
export async function withContext<T>(fn: (ctx: TenantContext, session: SessionInfo) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; state: ActionState }> {
  try {
    const { ctx, session } = await actionContext();
    return { ok: true, value: await fn(ctx, session) };
  } catch (err) {
    return { ok: false, state: toErrorState(err) };
  }
}

export function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/** Lee un campo JSON (p. ej. las líneas de un documento) enviado como input oculto. */
export function jsonField<T = unknown>(form: FormData, name: string): T | undefined {
  const raw = form.get(name);
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ValidationError("Formulario inválido. Recarga la página.");
  }
}
