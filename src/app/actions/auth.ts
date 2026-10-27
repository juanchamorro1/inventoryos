"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { formToObject, toErrorState } from "@/server/actions/run";
import { clearSession, getSession, requestMeta, setSessionCookie } from "@/server/auth/session";
import { authenticate, changePassword, createOrganization, createSession, registerOwner, setActiveOrganization } from "@/server/modules/auth/service";
import { withUserTx } from "@/server/db/tx";
import { env } from "@/server/env";
import { acceptInvitation, acceptInvitationWithNewAccount } from "@/server/modules/invitations/service";
import { safeNext } from "@/lib/safe-next";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "@/server/platform/errors";
import { isPlatformAdmin } from "@/server/modules/platform/service";

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const data = formToObject(form);
  try {
    const meta = await requestMeta();
    const userId = await authenticate(data.email ?? "", data.password ?? "", meta.ip);
    const { token, expiresAt } = await createSession(userId, meta);
    await setSessionCookie(token, expiresAt);
  } catch (err) {
    return toErrorState(err);
  }
  redirect(safeNext(data.next) ?? "/dashboard");
}

export async function registerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const data = formToObject(form);
  try {
    if (!env().ALLOW_SIGNUP) throw new ValidationError("El registro público está deshabilitado. Pide a un administrador que te invite.");
    if (data.password !== data.passwordConfirm) {
      throw new ValidationError("Las contraseñas no coinciden.", { passwordConfirm: ["Las contraseñas no coinciden."] });
    }
    const { userId } = await registerOwner(data);
    const meta = await requestMeta();
    const { token, expiresAt } = await createSession(userId, meta);
    await setSessionCookie(token, expiresAt);
  } catch (err) {
    return toErrorState(err);
  }
  redirect("/dashboard");
}

export async function logoutAction(form?: FormData) {
  await clearSession();
  const next = safeNext(form?.get("next"));
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
}

export async function switchOrganizationAction(form: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const organizationId = z.string().uuid().safeParse(form.get("organizationId"));
  if (organizationId.success) {
    try {
      await setActiveOrganization(session, organizationId.data);
    } catch {
      redirect("/organizations");
    }
  }
  redirect("/dashboard");
}

export async function createOrganizationAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const session = await getSession();
    if (!session) throw new UnauthenticatedError();
    // Con el registro cerrado, las empresas nuevas solo las crea un administrador de plataforma (desde Plataforma).
    if (!env().ALLOW_SIGNUP && !(await isPlatformAdmin(session.user.id))) {
      throw new ForbiddenError("Las empresas nuevas las crea el equipo de InventoryOS. Escríbenos para abrir una.");
    }
    const parsed = z
      .object({ name: z.string().trim().min(2, "Escribe el nombre de la empresa.").max(120), currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Código ISO de 3 letras.") })
      .safeParse(formToObject(form));
    if (!parsed.success) throw new ValidationError("Revisa los datos.", z.flattenError(parsed.error).fieldErrors);
    const organizationId = await withUserTx(session.user.id, (tx) => createOrganization(tx, { userId: session.user.id, name: parsed.data.name, currency: parsed.data.currency }));
    await setActiveOrganization(session, organizationId);
  } catch (err) {
    return toErrorState(err);
  }
  redirect("/dashboard");
}

export async function changePasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const data = formToObject(form);
  try {
    const session = await getSession();
    if (!session) throw new UnauthenticatedError();
    if (data.newPassword !== data.newPasswordConfirm) {
      throw new ValidationError("Las contraseñas no coinciden.", { newPasswordConfirm: ["Las contraseñas no coinciden."] });
    }
    await changePassword(session.user.id, data.currentPassword ?? "", data.newPassword ?? "", session.tokenHash);
    return { ok: true, message: "Contraseña actualizada. Se cerraron tus otras sesiones.", at: Date.now() };
  } catch (err) {
    return toErrorState(err);
  }
}

/** Acepta una invitación con la cuenta de la sesión actual (el correo debe coincidir con el invitado). */
export async function acceptInvitationAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const session = await getSession();
    if (!session) throw new UnauthenticatedError("Inicia sesión para aceptar la invitación.");
    const { organizationId } = await acceptInvitation(String(form.get("token") ?? ""), session.user.id);
    await setActiveOrganization(session, organizationId);
  } catch (err) {
    return toErrorState(err);
  }
  redirect("/dashboard");
}

/** Crea la cuenta de la persona invitada con su propia contraseña. No depende de ALLOW_SIGNUP: requiere una invitación válida. */
export async function acceptInvitationNewAccountAction(_: ActionState, form: FormData): Promise<ActionState> {
  const data = formToObject(form);
  try {
    if (await getSession()) throw new ValidationError("Ya tienes una sesión abierta. Recarga la página.");
    if (data.password !== data.passwordConfirm) {
      throw new ValidationError("Las contraseñas no coinciden.", { passwordConfirm: ["Las contraseñas no coinciden."] });
    }
    const { userId } = await acceptInvitationWithNewAccount(data.token ?? "", { name: data.name, password: data.password ?? "" });
    const meta = await requestMeta();
    const { token, expiresAt } = await createSession(userId, meta);
    await setSessionCookie(token, expiresAt);
  } catch (err) {
    return toErrorState(err);
  }
  redirect("/dashboard");
}
