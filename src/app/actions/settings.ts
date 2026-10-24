"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { formToObject, withContext } from "@/server/actions/run";
import { createApiKey, revokeApiKey } from "@/server/modules/api-keys/service";
import { createInvitation, revokeInvitation } from "@/server/modules/invitations/service";
import { updateMember, updateOrganization } from "@/server/modules/organizations/service";
import { env } from "@/server/env";

export async function updateOrganizationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const d = formToObject(form);
  const r = await withContext((ctx) => updateOrganization(ctx, { ...d, lowStockAlerts: d.lowStockAlerts === "on" }));
  if (!r.ok) return r.state;
  revalidatePath("/", "layout");
  return { ok: true, message: "Configuración guardada.", at: Date.now() };
}

export async function createInvitationAction(_: ActionState, form: FormData): Promise<ActionState<{ link: string; email: string }>> {
  const d = formToObject(form);
  const r = await withContext((ctx) => createInvitation(ctx, { email: d.email, role: d.role }));
  if (!r.ok) return r.state as ActionState<{ link: string; email: string }>;
  revalidatePath("/settings/members");
  return { ok: true, data: { link: `${env().APP_URL}/invite/${r.value.token}`, email: d.email!.trim().toLowerCase() }, at: Date.now() };
}

export async function revokeInvitationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const r = await withContext((ctx) => revokeInvitation(ctx, String(form.get("id") ?? "")));
  if (!r.ok) return r.state;
  revalidatePath("/settings/members");
  return { ok: true, message: "Invitación anulada: el enlace ya no funciona.", at: Date.now() };
}

export async function updateMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  const userId = String(form.get("userId") ?? "");
  const r = await withContext((ctx) => updateMember(ctx, userId, { role: form.get("role"), status: form.get("status") }));
  if (!r.ok) return r.state;
  revalidatePath("/settings/members");
  return { ok: true, message: "Miembro actualizado.", at: Date.now() };
}

export async function createApiKeyAction(_: ActionState, form: FormData): Promise<ActionState<{ key: string }>> {
  const r = await withContext((ctx) => createApiKey(ctx, { name: form.get("name"), scopes: form.getAll("scopes") }));
  if (!r.ok) return r.state as ActionState<{ key: string }>;
  revalidatePath("/settings/api-keys");
  return { ok: true, data: { key: r.value.key }, at: Date.now() };
}

export async function revokeApiKeyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const r = await withContext((ctx) => revokeApiKey(ctx, String(form.get("id") ?? "")));
  if (!r.ok) return r.state;
  revalidatePath("/settings/api-keys");
  return { ok: true, message: "Clave revocada.", at: Date.now() };
}
