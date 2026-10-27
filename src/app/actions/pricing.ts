"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { formToObject, withContext } from "@/server/actions/run";
import {
  approvePriceChanges,
  recalculateAll,
  refreshRateNow,
  revertToAuto,
  setCategoryMargins,
  setManualPrice,
  setManualRate,
  setPricingModes,
  setRetailPriceFromScreen,
  updatePricingSettings,
  type RecalcSummary,
} from "@/server/modules/pricing/service";

// Acciones de precios. La autorización (pricing.manage) se verifica en el servicio.

const summaryText = (s: RecalcSummary) =>
  [
    `${s.evaluated} productos revisados`,
    s.applied ? `${s.applied} precios actualizados` : null,
    s.pending ? `${s.pending} cambios pendientes de aprobación` : null,
    s.noRate ? `${s.noRate} sin tasa válida (se conservan sus precios)` : null,
  ]
    .filter(Boolean)
    .join(" · ");

function done(message: string): ActionState {
  revalidatePath("/pricing", "layout");
  revalidatePath("/products", "layout");
  return { ok: true, message, at: Date.now() };
}

export async function updatePricingSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const r = await withContext((ctx) => updatePricingSettings(ctx, formToObject(form)));
  return r.ok ? done(`Configuración guardada. ${summaryText(r.value)}.`) : r.state;
}

export async function setManualRateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const d = formToObject(form);
  const r = await withContext((ctx) => setManualRate(ctx, { rate: d.rate, validFrom: d.validFrom || undefined, reason: d.reason }));
  return r.ok ? done(`TRM manual registrada. ${summaryText(r.value)}.`) : r.state;
}

export async function refreshRateAction(_: ActionState): Promise<ActionState> {
  const r = await withContext((ctx) => refreshRateNow(ctx));
  if (!r.ok) return r.state;
  const { refresh, recalc } = r.value;
  if (refresh.status === "error" || refresh.status === "rejected") return { ok: false, error: `${refresh.message} Se conserva la última tasa válida.`, at: Date.now() };
  return done(`${refresh.message}${recalc ? ` ${summaryText(recalc)}.` : ""}`);
}

export async function recalculateAction(_: ActionState): Promise<ActionState> {
  const r = await withContext((ctx) => recalculateAll(ctx));
  return r.ok ? done(`Recálculo terminado: ${summaryText(r.value)}.`) : r.state;
}

export async function approveChangesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ids = form.getAll("variantId").map(String).filter(Boolean);
  const all = form.get("all") === "1";
  const r = await withContext((ctx) => approvePriceChanges(ctx, { variantIds: all ? "all" : ids, reason: String(form.get("reason") ?? "") || undefined }));
  if (!r.ok) return r.state;
  done("");
  // La lista puede quedar vacía (y con ella el formulario): el resultado se muestra tras redirigir.
  redirect(`/pricing/changes?published=${r.value.prices}&variants=${r.value.variants}`);
}

export async function setManualPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const d = formToObject(form);
  const r = await withContext((ctx) => setManualPrice(ctx, { variantId: d.variantId, kind: d.kind, price: d.price, reason: d.reason, acceptBelowCost: d.acceptBelowCost === "on" }));
  return r.ok ? done("Precio manual guardado. Las actualizaciones automáticas no lo cambiarán.") : r.state;
}

export async function revertToAutoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const d = formToObject(form);
  const r = await withContext((ctx) => revertToAuto(ctx, { variantId: d.variantId, kind: d.kind, reason: d.reason }));
  return r.ok ? done("El precio volvió a modo automático.") : r.state;
}

export async function quickPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const d = formToObject(form);
  const r = await withContext((ctx) =>
    setRetailPriceFromScreen(ctx, { variantId: d.variantId, price: d.price, includesTax: d.includesTax === "true", acceptBelowCost: d.acceptBelowCost === "on" }),
  );
  return r.ok ? done("Precio actualizado.") : r.state;
}

export async function setPricingModesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const r = await withContext((ctx) => setPricingModes(ctx, { retailAutoEnabled: form.get("retailAutoEnabled") === "on", wholesaleEnabled: form.get("wholesaleEnabled") === "on" }));
  if (!r.ok) return r.state;
  revalidatePath("/settings/pricing-modes");
  return done(`Cambios guardados.${r.value ? ` ${summaryText(r.value)}.` : ""}`);
}

export async function setCategoryMarginsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const d = formToObject(form);
  const r = await withContext((ctx) => setCategoryMargins(ctx, d.categoryId ?? "", { retailMargin: d.retailMargin, wholesaleMargin: d.wholesaleMargin }));
  return r.ok ? done(`Márgenes de la categoría guardados. ${summaryText(r.value)}.`) : r.state;
}
