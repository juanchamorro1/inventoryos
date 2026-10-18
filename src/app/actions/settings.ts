"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { formToObject, withContext } from "@/server/actions/run";
import { createApiKey, revokeApiKey } from "@/server/modules/api-keys/service";
import { addMember, updateMember, updateOrganization } from "@/server/modules/organizations/service";

export async function updateOrganizationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const d = formToObject(form);
  const r = await withContext((ctx) => updateOrganization(ctx, { ...d, lowStockAlerts: d.lowStockAlerts === "on" }));
  if (!r.ok) return r.state;
  revalidatePath("/", "layout");
  return { ok: true, message: "Configuración guardada.", at: Date.now() };
}

export async function addMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  const d = formToObject(form);
  const r = await withContext((ctx) => addMember(ctx, { ...d, password: d.password || undefined }));
  if (!r.ok) return r.state;
  revalidatePath("/settings/members");
  return {
    ok: true,
    message: r.value.created
      ? "Usuario creado y agregado. Comunícale su contraseña inicial por un canal seguro y pídele cambiarla en «Mi cuenta»."
      : "La persona ya tenía cuenta: se agregó a la empresa con el rol indicado.",
    at: Date.now(),
  };
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
