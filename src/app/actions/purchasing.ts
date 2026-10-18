"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { formToObject, jsonField, withContext } from "@/server/actions/run";
import {
  cancelOrClosePurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  issuePurchaseOrder,
  receivePurchaseOrder,
  reverseGoodsReceipt,
  setSupplierStatus,
  updatePurchaseOrder,
  updateSupplier,
} from "@/server/modules/purchasing/service";

export async function createSupplierAction(_: ActionState, form: FormData): Promise<ActionState> {
  const r = await withContext((ctx) => createSupplier(ctx, formToObject(form)));
  if (!r.ok) return r.state;
  revalidatePath("/purchasing/suppliers");
  redirect(`/purchasing/suppliers/${r.value}`);
}

export async function updateSupplierAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const r = await withContext((ctx) => updateSupplier(ctx, id, formToObject(form)));
  if (!r.ok) return r.state;
  revalidatePath(`/purchasing/suppliers/${id}`);
  return { ok: true, message: "Proveedor actualizado.", at: Date.now() };
}

export async function supplierStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const r = await withContext((ctx) => setSupplierStatus(ctx, id, form.get("op") === "archive" ? "archived" : "active"));
  if (!r.ok) return r.state;
  revalidatePath(`/purchasing/suppliers/${id}`);
  return { ok: true, message: "Cambios guardados.", at: Date.now() };
}

function poPayload(form: FormData) {
  const d = formToObject(form);
  return { supplierId: d.supplierId, warehouseId: d.warehouseId, expectedDate: d.expectedDate || null, notes: d.notes, lines: jsonField(form, "lines") ?? [] };
}

export async function createPurchaseOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const r = await withContext((ctx) => createPurchaseOrder(ctx, poPayload(form)));
  if (!r.ok) return r.state;
  revalidatePath("/purchasing/orders");
  redirect(`/purchasing/orders/${r.value}`);
}

export async function updatePurchaseOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const r = await withContext((ctx) => updatePurchaseOrder(ctx, id, poPayload(form)));
  if (!r.ok) return r.state;
  redirect(`/purchasing/orders/${id}`);
}

export async function issuePurchaseOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const r = await withContext((ctx) => issuePurchaseOrder(ctx, id));
  if (!r.ok) return r.state;
  revalidatePath(`/purchasing/orders/${id}`);
  return { ok: true, message: "Orden emitida.", at: Date.now() };
}

export async function cancelPurchaseOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const r = await withContext((ctx) => cancelOrClosePurchaseOrder(ctx, id, form.get("reason")));
  if (!r.ok) return r.state;
  revalidatePath(`/purchasing/orders/${id}`);
  return { ok: true, message: r.value === "closed" ? "Orden cerrada." : "Orden cancelada.", at: Date.now() };
}

export async function receivePurchaseOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const lines = Object.entries(formToObject(form))
    .filter(([k, v]) => k.startsWith("qty:") && v.trim() !== "" && v.trim() !== "0")
    .map(([k, v]) => ({ lineId: k.slice(4), quantity: v }));
  const r = await withContext((ctx) =>
    receivePurchaseOrder(ctx, id, { locationId: form.get("locationId"), notes: form.get("notes"), idempotencyKey: form.get("idempotencyKey"), lines }),
  );
  if (!r.ok) return r.state;
  revalidatePath(`/purchasing/orders/${id}`);
  redirect(`/purchasing/orders/${id}`);
}

export async function reverseReceiptAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("receiptId") ?? "");
  const orderId = String(form.get("orderId") ?? "");
  const r = await withContext((ctx) => reverseGoodsReceipt(ctx, id, form.get("reason")));
  if (!r.ok) return r.state;
  revalidatePath(`/purchasing/orders/${orderId}`);
  return { ok: true, message: "Recepción anulada.", at: Date.now() };
}
