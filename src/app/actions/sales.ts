"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { formToObject, jsonField, withContext } from "@/server/actions/run";
import { archiveCustomer, cancelSale, createCustomer, createSale, returnSale, updateCustomer } from "@/server/modules/sales/service";

export async function createSaleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const d = formToObject(form);
  const r = await withContext((ctx) =>
    createSale(ctx, {
      customerId: d.customerId || null,
      locationId: d.locationId,
      paymentMethod: d.paymentMethod,
      notes: d.notes,
      idempotencyKey: d.idempotencyKey,
      lines: jsonField(form, "lines") ?? [],
    }),
  );
  if (!r.ok) return r.state;
  revalidatePath("/sales");
  redirect(`/sales/${r.value.saleId}?created=1`);
}

export async function cancelSaleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const r = await withContext((ctx) => cancelSale(ctx, id, form.get("reason")));
  if (!r.ok) return r.state;
  revalidatePath(`/sales/${id}`);
  return { ok: true, message: "Venta anulada.", at: Date.now() };
}

export async function returnSaleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const lines = Object.entries(formToObject(form))
    .filter(([k, v]) => k.startsWith("ret:") && v.trim() !== "" && v.trim() !== "0")
    .map(([k, v]) => ({ saleLineId: k.slice(4), quantity: v }));
  const r = await withContext((ctx) => returnSale(ctx, id, { reason: form.get("reason"), idempotencyKey: form.get("idempotencyKey"), lines }));
  if (!r.ok) return r.state;
  revalidatePath(`/sales/${id}`);
  redirect(`/sales/${id}`);
}

export async function createCustomerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const r = await withContext((ctx) => createCustomer(ctx, formToObject(form)));
  if (!r.ok) return r.state;
  revalidatePath("/customers");
  return { ok: true, message: "Cliente creado.", at: Date.now() };
}

export async function updateCustomerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const r = await withContext((ctx) => updateCustomer(ctx, id, formToObject(form)));
  if (!r.ok) return r.state;
  revalidatePath(`/customers/${id}`);
  return { ok: true, message: "Cliente actualizado.", at: Date.now() };
}

export async function archiveCustomerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const r = await withContext((ctx) => archiveCustomer(ctx, id));
  if (!r.ok) return r.state;
  revalidatePath("/customers");
  redirect("/customers");
}
