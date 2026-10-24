"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { toErrorState } from "@/server/actions/run";
import { dropSessionCookie, getSession, requestMeta } from "@/server/auth/session";
import { requestPasswordReset, resetPassword, revokeAllSessions } from "@/server/modules/auth/recovery";
import { UnauthenticatedError, ValidationError } from "@/server/platform/errors";

// Respuesta idéntica exista o no la cuenta (no permite averiguar qué correos están registrados).
const NEUTRAL =
  "Si el correo corresponde a una cuenta activa, enviaremos un enlace para restablecer la contraseña. Si no te llega en unos minutos, pide ayuda al soporte de InventoryOS.";

export async function requestPasswordResetAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ip } = await requestMeta();
    await requestPasswordReset(form.get("email"), ip);
    return { ok: true, message: NEUTRAL, at: Date.now() };
  } catch (err) {
    return toErrorState(err);
  }
}

export async function resetPasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("passwordConfirm") ?? "")) {
      throw new ValidationError("Las contraseñas no coinciden.", { passwordConfirm: ["Las contraseñas no coinciden."] });
    }
    const { ip } = await requestMeta();
    await resetPassword(form.get("token"), password, ip);
  } catch (err) {
    return toErrorState(err);
  }
  // Por seguridad no se inicia sesión automáticamente: la persona entra con su contraseña nueva.
  redirect("/login?reset=1");
}

/** Cierra todas las sesiones de la cuenta en todos los dispositivos y empresas (distinto de «Salir», que cierra solo esta). */
export async function revokeAllMySessionsAction(_: ActionState): Promise<ActionState> {
  try {
    const session = await getSession();
    if (!session) throw new UnauthenticatedError();
    const { ip } = await requestMeta();
    await revokeAllSessions(session.user.id, ip);
    await dropSessionCookie();
  } catch (err) {
    return toErrorState(err);
  }
  redirect("/login?sessions=closed");
}
