"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { formToObject, jsonField, withContext } from "@/server/actions/run";
import { postManualDocument, reconcile, reverseDocument } from "@/server/modules/inventory/service";
import {
  createLocation,
  createWarehouse,
  setDefaultWarehouse,
  setLocationStatus,
  setWarehouseStatus,
  updateWarehouse,
} from "@/server/modules/warehouses/service";

export async function postDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const data = formToObject(form);
  const r = await withContext((ctx) => postManualDocument(ctx, { ...data, lines: jsonField(form, "lines") ?? [] }));
  if (!r.ok) return r.state;
  revalidatePath("/inventory");
  redirect(`/inventory/documents/${r.value.documentId}?done=1`);
}

export async function reverseDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("documentId") ?? "");
  const r = await withContext((ctx) => reverseDocument(ctx, id, form.get("reason")));
  if (!r.ok) return r.state;
  revalidatePath("/inventory");
  redirect(`/inventory/documents/${r.value.documentId}?undone=1`);
}

export async function reconcileAction(_: ActionState): Promise<ActionState<Awaited<ReturnType<typeof reconcile>>>> {
  const r = await withContext((ctx) => reconcile(ctx));
  if (!r.ok) return r.state as ActionState<never>;
  return { ok: true, data: r.value, at: Date.now() };
}

// ---------- Bodegas y ubicaciones ----------

export async function createWarehouseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const r = await withContext((ctx) => createWarehouse(ctx, formToObject(form)));
  if (!r.ok) return r.state;
  revalidatePath("/warehouses");
  redirect(`/warehouses/${r.value}`);
}

export async function updateWarehouseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const r = await withContext((ctx) => updateWarehouse(ctx, id, formToObject(form)));
  if (!r.ok) return r.state;
  revalidatePath(`/warehouses/${id}`);
  return { ok: true, message: "Bodega actualizada.", at: Date.now() };
}

export async function warehouseStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const op = String(form.get("op") ?? "");
  const r = await withContext((ctx) =>
    op === "default" ? setDefaultWarehouse(ctx, id) : setWarehouseStatus(ctx, id, op === "archive" ? "archived" : "active"),
  );
  if (!r.ok) return r.state;
  revalidatePath("/warehouses");
  revalidatePath(`/warehouses/${id}`);
  return { ok: true, message: "Cambios guardados.", at: Date.now() };
}

export async function createLocationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const warehouseId = String(form.get("warehouseId") ?? "");
  const r = await withContext((ctx) => createLocation(ctx, warehouseId, formToObject(form)));
  if (!r.ok) return r.state;
  revalidatePath(`/warehouses/${warehouseId}`);
  return { ok: true, message: "Ubicación creada.", at: Date.now() };
}

export async function locationStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const warehouseId = String(form.get("warehouseId") ?? "");
  const r = await withContext((ctx) => setLocationStatus(ctx, id, form.get("op") === "archive" ? "archived" : "active"));
  if (!r.ok) return r.state;
  revalidatePath(`/warehouses/${warehouseId}`);
  return { ok: true, message: "Cambios guardados.", at: Date.now() };
}
