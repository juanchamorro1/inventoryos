"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { toErrorState } from "@/server/actions/run";
import { getSession, requestMeta } from "@/server/auth/session";
import { resetLink } from "@/server/modules/auth/recovery";
import { blockUser, issuePasswordResetLink, requirePlatformAdmin, revokeUserSessions, unblockUser } from "@/server/modules/platform/service";

// Acciones de plataforma. La autorización se verifica en el servicio (requirePlatformAdmin + revalidación en la transacción).

async function platformContext() {
  const { ip } = await requestMeta();
  return requirePlatformAdmin(await getSession(), ip);
}

async function run(fn: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await fn();
    revalidatePath("/platform");
    return { ok: true, message, at: Date.now() };
  } catch (err) {
    return toErrorState(err);
  }
}

export async function blockUserAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    await blockUser(await platformContext(), form.get("userId"), form.get("reason"));
    return "Cuenta bloqueada. Se cerraron todas sus sesiones.";
  });
}

export async function unblockUserAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    await unblockUser(await platformContext(), form.get("userId"));
    return "Cuenta desbloqueada. Deberá iniciar sesión de nuevo.";
  });
}

export async function revokeUserSessionsAction(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const n = await revokeUserSessions(await platformContext(), form.get("userId"));
    return n === 1 ? "Se cerró 1 sesión." : `Se cerraron ${n} sesiones.`;
  });
}

export async function issueResetLinkAction(_: ActionState, form: FormData): Promise<ActionState<{ link: string }>> {
  try {
    const { token } = await issuePasswordResetLink(await platformContext(), form.get("userId"));
    revalidatePath("/platform");
    return { ok: true, data: { link: resetLink(token) }, at: Date.now() };
  } catch (err) {
    return toErrorState(err) as ActionState<{ link: string }>;
  }
}
