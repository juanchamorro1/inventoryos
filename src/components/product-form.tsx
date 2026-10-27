"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";
import { normalizeNumber, toDisplayNumber } from "@/lib/parse-number";
import { ActionForm, FieldError, SubmitButton, useFormState } from "./form";
import { buttonClass, cx, Hint, inputClass, Label } from "./ui";

type Variant = {
  id?: string;
  sku: string;
  barcode: string;
  name: string;
  optionValues: Record<string, string>;
  /** Costo original en su moneda. */
  costPrice: string;
  costCurrency: "COP" | "USD";
  extraCostCop: string;
  referenceCode: string;
  /** Precio minorista escrito a mano (vacío = automático). Se muestra con o sin IVA según la casilla. */
  salePrice: string;
  /** Precio mayorista escrito a mano (vacío = automático). */
  wholesalePrice: string;
  wholesaleMinQty: string;
  /** Valor agregado del mayorista: mayorista (sin IVA) = costo + valor, en plata o en % del costo. */
  wholesaleMarkupType: "amount" | "percent";
  wholesaleMarkupValue: string;
  /** Sugeridos actuales (solo para mostrar al editar). */
  suggestedRetail?: string | null;
  suggestedWholesale?: string | null;
  lowStockThreshold: string;
  initialStock: string;
};

/** Datos para estimar el precio automático en pantalla (solo visual; el cálculo real ocurre en el servidor). */
export type PricingHints = {
  retailMargin: string;
  wholesaleMargin: string;
  appliedRate: string | null;
  extraCostPercent: string;
  roundingStep: string;
  roundingMode: "up" | "nearest" | "none";
  /** Apagado: el precio de venta es obligatorio y no hay cálculo automático. */
  retailAutoEnabled: boolean;
  /** Apagado: no se muestran los campos de precio mayorista. */
  wholesaleEnabled: boolean;
  /** Redondear hacia arriba lo que paga el cliente (con impuesto) al múltiplo indicado. */
  roundClientPrice?: boolean;
  clientPriceStep?: string;
};

export type ProductFormValues = {
  productId?: string;
  name: string;
  description: string;
  categoryName: string;
  brandName: string;
  taxRateId: string;
  supplierName: string;
  retailMargin: string;
  wholesaleMargin: string;
  unit: string;
  attributes: Record<string, string>;
  options: { name: string; values: string[] }[];
  /** Precios SIN impuesto (como se guardan). */
  variants: Omit<Variant, "initialStock">[];
};

type Choice = { id: string; name: string };

const blank = (): Variant => ({
  sku: "",
  barcode: "",
  name: "",
  optionValues: {},
  costPrice: "",
  costCurrency: "COP",
  extraCostCop: "",
  referenceCode: "",
  salePrice: "",
  wholesalePrice: "",
  wholesaleMinQty: "",
  wholesaleMarkupType: "percent",
  wholesaleMarkupValue: "",
  lowStockThreshold: "",
  initialStock: "",
});

type Computed = { net: Decimal; gross: Decimal; rounded: boolean; unrounded: Decimal };

/**
 * Precio al detal (decimal.js): el escrito, con o sin impuesto según la casilla. Si el redondeo está encendido,
 * lo que paga el cliente sube al múltiplo y se guarda el precio sin impuesto equivalente.
 */
function computeRetail(v: Variant, rate: string, taxIncluded: boolean, round: { on: boolean; step: string }): Computed | null {
  const typed = normalizeNumber(v.salePrice);
  if (typed === null) return null;
  const f = factor(rate);
  // A centavos antes de redondear: un precio ya redondeado (p. ej. 67.394,958 × 1,19) no debe subir otro escalón.
  const gross = (taxIncluded ? new Decimal(typed) : new Decimal(typed).times(f)).toDecimalPlaces(2);
  const step = new Decimal(round.step || "100");
  const finalGross = round.on && step.gt(0) ? gross.div(step).ceil().times(step) : gross;
  return { net: round.on || taxIncluded ? finalGross.div(f) : new Decimal(typed), gross: finalGross, rounded: !finalGross.eq(gross), unrounded: gross };
}

/** Mayorista sin IVA con valor agregado (costo + valor); null si no aplica. El servidor repite este cálculo. */
function computeWholesaleMarkup(v: Variant): Decimal | null {
  const cost = normalizeNumber(v.costPrice);
  const markup = normalizeNumber(v.wholesaleMarkupValue);
  if (cost === null || markup === null || v.costCurrency !== "COP") return null;
  const c = new Decimal(cost);
  return c.plus(v.wholesaleMarkupType === "percent" ? c.times(markup).div(100) : new Decimal(markup)).toDecimalPlaces(4);
}

/** Texto para mostrar un decimal en un campo ("80200" o "1785,5"). */
const showDec = (d: Decimal) => d.toDecimalPlaces(2).toString().replace(".", ",");

// --- Conversión con/sin IVA (decimal.js: sin errores de punto flotante) ---
const factor = (rate: string) => new Decimal(rate || "0").div(100).plus(1);
/** Texto que escribió la persona (con IVA) → precio sin IVA con 4 decimales fijos (el servidor lo lee como decimal). */
function toNet(text: string, rate: string): string {
  const n = normalizeNumber(text);
  return n === null ? text : new Decimal(n).div(factor(rate)).toFixed(4);
}
/** Precio sin IVA → texto con IVA para mostrar en el campo ("1785" o "1785,5"). */
function toGross(text: string, rate: string): string {
  const n = normalizeNumber(text);
  if (n === null) return text;
  return new Decimal(n).times(factor(rate)).toDecimalPlaces(2).toString().replace(".", ",");
}
function fromGrossToNetText(text: string, rate: string): string {
  const n = normalizeNumber(text);
  return n === null ? text : new Decimal(n).div(factor(rate)).toDecimalPlaces(2).toString().replace(".", ",");
}

/** Estimación visual del precio automático (Number solo para mostrar). */
function estimate(v: Variant, hints: PricingHints, margin: string): number | null {
  const cost = toDisplayNumber(v.costPrice);
  if (!cost) return null;
  let cop = cost;
  if (v.costCurrency === "USD") {
    if (!hints.appliedRate) return null;
    cop = cost * Number(hints.appliedRate);
  }
  const total = cop * (1 + Number(hints.extraCostPercent) / 100) + toDisplayNumber(v.extraCostCop);
  const m = Number(margin);
  if (!(m >= 0 && m < 100)) return null;
  const raw = total / (1 - m / 100);
  const step = Number(hints.roundingStep) || 1;
  return hints.roundingMode === "none" ? raw : hints.roundingMode === "up" ? Math.ceil(raw / step) * step : Math.round(raw / step) * step;
}

/** Errores de variantes devueltos por el servidor, con número de variante. */
function VariantErrors() {
  const state = useFormState();
  const entries = Object.entries(state.fieldErrors ?? {}).filter(([k]) => k.startsWith("variants.") || k === "sku" || k === "barcode");
  if (!entries.length) return null;
  return (
    <ul className="space-y-0.5 text-sm text-danger">
      {entries.map(([k, v]) => {
        const m = k.match(/^variants\.(\d+)\.(\w+)/);
        return <li key={k}>{m ? `Presentación ${Number(m[1]) + 1}: ${v[0]}` : v[0]}</li>;
      })}
    </ul>
  );
}

/** Resumen grande: lo que paga el cliente, el IVA y lo que ganas (precio al cliente − lo que te cuesta). */
function PricePreview({ v, c, taxRate, currency, autoValue }: { v: Variant; c: Computed | null; taxRate: number; currency: string; autoValue: number | null }) {
  // Number solo para mostrar.
  const net = c ? Number(c.net) : (autoValue ?? 0);
  if (!net) return null;
  const gross = c ? Number(c.gross) : net * (1 + taxRate / 100);
  const cost = v.costCurrency === "COP" ? toDisplayNumber(v.costPrice) : 0;
  const gain = gross - cost;
  return (
    <div className={cx("rounded-lg border p-4", cost > 0 && net < cost ? "border-danger/40 bg-danger/5" : "border-primary/30 bg-primary/5")} aria-live="polite" data-testid="price-preview">
      <p className="text-sm text-muted">{c ? "El cliente paga" : "Precio automático: el cliente pagaría"}</p>
      <p className="text-2xl font-bold">{formatMoney(gross, currency)}</p>
      {c?.rounded && <p className="text-xs text-muted">Redondeado desde {formatMoney(Number(c.unrounded), currency)}</p>}
      <p className="mt-1 text-sm">
        {taxRate > 0 ? (
          <>
            Sin IVA: {formatMoney(net, currency)} · IVA: {formatMoney(gross - net, currency)}
          </>
        ) : (
          "Sin impuesto"
        )}
      </p>
      {cost > 0 && (
        <p className={cx("mt-1 text-sm font-medium", gain < 0 ? "text-danger" : "text-success")}>
          {gain < 0 ? `Pierdes ${formatMoney(-gain, currency)} por unidad` : `Ganas ${formatMoney(gain, currency)} por unidad`} <span className="font-normal text-muted">(lo que paga el cliente − lo que te cuesta)</span>
        </p>
      )}
      {cost > 0 && net < cost && <p className="mt-1 text-sm text-danger">El precio sin IVA es menor que lo que te cuesta.</p>}
    </div>
  );
}

export function ProductForm({
  action,
  initial,
  categories,
  brands,
  taxRates,
  submitLabel,
  currency,
  canSetStock,
  suppliers = [],
  pricing,
  profile = { attributes: [], productExample: "Ej.: Nombre del producto", pricesIncludeTax: false },
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  initial: ProductFormValues;
  categories: Choice[];
  brands: Choice[];
  taxRates: (Choice & { rate: string; isDefault: boolean })[];
  submitLabel: string;
  currency: string;
  /** Muestra «cantidad que tienes hoy» (solo al crear y con permiso de inventario). */
  canSetStock: boolean;
  suppliers?: Choice[];
  pricing: PricingHints;
  /** Datos según el tipo de negocio (p. ej. «Tamaño» en cosmética) y si los precios se escriben con IVA incluido. */
  profile?: { attributes: { name: string; example: string }[]; productExample: string; pricesIncludeTax?: boolean };
}) {
  const isEdit = Boolean(initial.productId);
  const [name, setName] = useState(initial.name);
  const [taxRateId, setTaxRateId] = useState(isEdit ? initial.taxRateId : initial.taxRateId || (taxRates.find((t) => t.isDefault)?.id ?? ""));
  const rateOf = (id: string) => taxRates.find((t) => t.id === id)?.rate ?? "0";
  const rateStr = rateOf(taxRateId);
  const taxRate = Number(rateStr);
  const [taxIncluded, setTaxIncluded] = useState(Boolean(profile.pricesIncludeTax) && Number(rateOf(isEdit ? initial.taxRateId : taxRateId)) > 0);
  const [hasVariants, setHasVariants] = useState(initial.variants.length > 1 || initial.options.length > 0);
  const [options, setOptions] = useState(initial.options.length ? initial.options.map((o) => ({ name: o.name, values: o.values.join(", ") })) : [{ name: "Color", values: "" }]);
  const [variants, setVariants] = useState<Variant[]>(() =>
    initial.variants.length
      ? initial.variants.map((v) => ({
          ...v,
          initialStock: "",
          // Los precios llegan sin IVA; si la casilla empieza marcada se muestran con IVA.
          ...(taxIncluded ? { salePrice: v.salePrice && toGross(v.salePrice, rateStr), wholesalePrice: v.wholesalePrice && toGross(v.wholesalePrice, rateStr) } : {}),
        }))
      : [blank()],
  );
  const [attributes, setAttributes] = useState(() => {
    const rows = Object.entries(initial.attributes).map(([key, value]) => ({ key, value }));
    // Los datos del tipo de negocio aparecen siempre (vacíos si el producto aún no los tiene).
    for (const a of profile.attributes) if (!rows.some((r) => r.key.toLowerCase() === a.name.toLowerCase())) rows.push({ key: a.name, value: "" });
    return rows;
  });
  const profileKeys = new Set(profile.attributes.map((a) => a.name.toLowerCase()));
  const setAttribute = (key: string, value: string) =>
    setAttributes((p) => (p.some((a) => a.key.toLowerCase() === key.toLowerCase()) ? p.map((a) => (a.key.toLowerCase() === key.toLowerCase() ? { ...a, value } : a)) : [...p, { key, value }]));
  const [retailMargin, setRetailMargin] = useState(initial.retailMargin);
  const [wholesaleMargin, setWholesaleMargin] = useState(initial.wholesaleMargin);
  const effRetail = retailMargin.trim() ? retailMargin.replace(",", ".") : pricing.retailMargin;
  const effWholesale = wholesaleMargin.trim() ? wholesaleMargin.replace(",", ".") : pricing.wholesaleMargin;
  // Moneda del costo y gastos adicionales solo importan con precios automáticos (o si ya se usaban).
  const showCostExtras = pricing.retailAutoEnabled || variants.some((v) => v.costCurrency === "USD" || toDisplayNumber(v.extraCostCop) > 0);

  const optionDefs = options.map((o) => ({ name: o.name.trim(), values: o.values.split(",").map((v) => v.trim()).filter(Boolean) })).filter((o) => o.name);
  const optionNames = hasVariants ? optionDefs.map((o) => o.name) : [];
  const single = variants[0] ?? blank();
  const setSingle = (patch: Partial<Variant>) => setVariants((p) => [{ ...(p[0] ?? blank()), ...patch }, ...p.slice(1)]);
  const setVariant = (i: number, patch: Partial<Variant>) => setVariants((p) => p.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  /** Al marcar o desmarcar «incluye IVA» se convierten los precios ya escritos para que no cambie lo que paga el cliente. */
  function toggleTaxIncluded(next: boolean) {
    const conv = next ? toGross : fromGrossToNetText;
    setVariants((p) => p.map((v) => ({ ...v, salePrice: v.salePrice && conv(v.salePrice, rateStr), wholesalePrice: v.wholesalePrice && conv(v.wholesalePrice, rateStr) })));
    setTaxIncluded(next);
  }
  const net = (text: string) => (text ? (taxIncluded ? toNet(text, rateStr) : text) : null);
  const round = { on: Boolean(pricing.roundClientPrice), step: pricing.clientPriceStep ?? "100" };
  const retail = (v: Variant) => computeRetail(v, rateStr, taxIncluded, round);
  /** Precio al detal sin impuesto que se envía (con el redondeo aplicado si está encendido). */
  const saleNet = (v: Variant) => (v.salePrice ? (retail(v)?.net.toFixed(4) ?? net(v.salePrice)) : null);
  const wholesaleCalc = (v: Variant) => (pricing.wholesaleEnabled ? computeWholesaleMarkup(v) : null);
  /** Lo que se muestra en el campo mayorista cuando lo calcula el valor agregado (con o sin IVA según la casilla). */
  const shownWholesale = (v: Variant) => {
    const w = wholesaleCalc(v);
    return w ? showDec(taxIncluded ? w.times(factor(rateStr)) : w) : v.wholesalePrice;
  };

  // Se calcula en cada render: es barato y evita memoizaciones frágiles.
  const payloadList = hasVariants ? variants : variants.slice(0, 1);
  const payloadVariants = JSON.stringify(
    payloadList.map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      sku: v.sku,
      barcode: v.barcode || null,
      name: v.name,
      optionValues: hasVariants ? Object.fromEntries(optionNames.map((n) => [n, v.optionValues[n] ?? ""]).filter(([, x]) => x)) : {},
      costAmount: v.costPrice || "0",
      costCurrency: v.costCurrency,
      extraCostCop: v.extraCostCop || "0",
      referenceCode: v.referenceCode || null,
      salePrice: saleNet(v),
      wholesalePrice: wholesaleCalc(v)?.toFixed(4) ?? net(v.wholesalePrice),
      wholesaleMarkupType: wholesaleCalc(v) ? v.wholesaleMarkupType : null,
      wholesaleMarkupValue: wholesaleCalc(v) ? v.wholesaleMarkupValue : null,
      wholesaleMinQty: v.wholesaleMinQty || null,
      lowStockThreshold: v.lowStockThreshold || "0",
      initialStock: v.initialStock || "0",
    })),
  );

  function generate() {
    if (!optionDefs.length || optionDefs.some((d) => !d.values.length)) return;
    let combos: Record<string, string>[] = [{}];
    for (const d of optionDefs) combos = combos.flatMap((c) => d.values.map((v) => ({ ...c, [d.name]: v })));
    setVariants((prev) => {
      const keep = prev.filter((v) => v.id || Object.keys(v.optionValues).length);
      const existing = new Set(keep.map((v) => JSON.stringify(v.optionValues)));
      const base = prev[0] ?? blank();
      const added = combos
        .filter((c) => !existing.has(JSON.stringify(c)))
        .map((c) => ({ ...blank(), optionValues: c, costPrice: base.costPrice, costCurrency: base.costCurrency, extraCostCop: base.extraCostCop, salePrice: base.salePrice, wholesalePrice: base.wholesalePrice, wholesaleMinQty: base.wholesaleMinQty, wholesaleMarkupType: base.wholesaleMarkupType, wholesaleMarkupValue: base.wholesaleMarkupValue, lowStockThreshold: base.lowStockThreshold }));
      return [...keep, ...added];
    });
  }

  const field = cx(inputClass);
  const priceLabel = taxIncluded ? "¿A cuánto lo vendes? (con IVA)" : "¿A cuánto lo vendes? (sin IVA)";
  const priceHint = pricing.retailAutoEnabled ? "Déjalo vacío para que la app lo calcule con tu margen." : "Obligatorio.";

  const wholesaleMarkupInput = (v: Variant, set: (patch: Partial<Variant>) => void, suffix: string) => (
    <div>
      <Label htmlFor={`wmarkup${suffix}`}>Valor agregado del mayorista</Label>
      <div className="flex gap-2">
        <input
          id={`wmarkup${suffix}`}
          inputMode="decimal"
          placeholder={v.wholesaleMarkupType === "percent" ? "Ej.: 19" : "Ej.: 12.000"}
          className={field}
          value={v.wholesaleMarkupValue}
          onChange={(e) => set({ wholesaleMarkupValue: e.target.value })}
        />
        <select aria-label="Tipo de valor agregado" id={`wmarkupType${suffix}`} className={cx(field, "w-36")} value={v.wholesaleMarkupType} onChange={(e) => set({ wholesaleMarkupType: e.target.value as "amount" | "percent" })}>
          <option value="percent">% del costo</option>
          <option value="amount">$ por unidad</option>
        </select>
      </div>
      <Hint>{v.costCurrency === "USD" ? "Solo disponible con costo en COP." : "Mayorista = lo que te cuesta + este valor (sin IVA). Déjalo vacío para escribir el precio mayorista a mano."}</Hint>
    </div>
  );

  const costInputs = (v: Variant, set: (patch: Partial<Variant>) => void, suffix: string) => (
    <>
      <div>
        <Label htmlFor={`costPrice${suffix}`}>¿Cuánto te cuesta?</Label>
        <div className="flex gap-2">
          <input id={`costPrice${suffix}`} inputMode="decimal" placeholder={v.costCurrency === "USD" ? "Ej.: 250,50" : "Ej.: 52.800"} className={cx(field, "h-12 text-lg")} value={v.costPrice} onChange={(e) => set({ costPrice: e.target.value })} />
          {showCostExtras && (
            <select aria-label="Moneda del costo" id={`costCurrency${suffix}`} className={cx(field, "h-12 w-24")} value={v.costCurrency} onChange={(e) => set({ costCurrency: e.target.value as "COP" | "USD" })}>
              <option value="COP">COP</option>
              <option value="USD">USD</option>
            </select>
          )}
        </div>
        <Hint>{v.costCurrency === "USD" ? "Se convierte con la TRM vigente + el ajuste configurado." : "Lo que pagas al proveedor por unidad."}</Hint>
      </div>
      {showCostExtras && (
        <div>
          <Label htmlFor={`extraCost${suffix}`}>Gastos adicionales por unidad (COP)</Label>
          <input id={`extraCost${suffix}`} inputMode="decimal" placeholder="Ej.: 15.000 (flete, nacionalización)" className={field} value={v.extraCostCop} onChange={(e) => set({ extraCostCop: e.target.value })} />
        </div>
      )}
    </>
  );

  return (
    <ActionForm action={action}>
      {initial.productId && <input type="hidden" name="productId" value={initial.productId} />}
      <input type="hidden" name="variants" value={payloadVariants} />
      <input type="hidden" name="options" value={JSON.stringify(hasVariants ? optionDefs : [])} />
      <input type="hidden" name="attributes" value={JSON.stringify(Object.fromEntries(attributes.filter((a) => a.key.trim() && a.value.trim()).map((a) => [a.key.trim(), a.value.trim()])))} />
      <input type="hidden" name="taxRateId" value={taxRateId} />
      <input type="hidden" name="retailMargin" value={retailMargin} />
      <input type="hidden" name="wholesaleMargin" value={wholesaleMargin} />

      {/* 1. Lo básico */}
      <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">1. ¿Qué producto es?</h2>
        <div>
          <Label htmlFor="name">Nombre del producto *</Label>
          <input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={profile.productExample} className={cx(field, "h-12 text-lg")} />
          <FieldError name="name" />
        </div>
        {profile.attributes.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {profile.attributes.map((pa) => (
              <div key={pa.name}>
                <Label htmlFor={`attr-${pa.name}`}>{pa.name}</Label>
                <input
                  id={`attr-${pa.name}`}
                  className={field}
                  placeholder={pa.example}
                  value={attributes.find((a) => a.key.toLowerCase() === pa.name.toLowerCase())?.value ?? ""}
                  onChange={(e) => setAttribute(pa.name, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="categoryName">Categoría</Label>
            <input id="categoryName" name="categoryName" list="category-list" defaultValue={initial.categoryName} placeholder="Elige una o escribe una nueva" className={field} />
            <datalist id="category-list">
              {categories.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="brandName">Marca</Label>
            <input id="brandName" name="brandName" list="brand-list" defaultValue={initial.brandName} placeholder="Opcional" className={field} />
            <datalist id="brand-list">
              {brands.map((b) => (
                <option key={b.id} value={b.name} />
              ))}
            </datalist>
          </div>
        </div>
      </section>

      {/* 2. Precio */}
      <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">2. Precio</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="tax">Impuesto</Label>
            <select id="tax" value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)} className={field}>
              <option value="">Sin impuesto</option>
              {taxRates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {taxRate > 0 && (
            <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm sm:mt-6">
              <input type="checkbox" className="h-5 w-5" checked={taxIncluded} onChange={(e) => toggleTaxIncluded(e.target.checked)} />
              <span>
                <span className="font-medium">El precio que escribo ya incluye el IVA</span>
                <span className="block text-xs text-muted">Escribe lo que paga el cliente; la app calcula el precio sin IVA.</span>
              </span>
            </label>
          )}
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={hasVariants} onChange={(e) => setHasVariants(e.target.checked)} />
          <span>
            <span className="font-medium">Este producto viene en varias presentaciones</span>
            <span className="block text-muted">Por ejemplo colores, tamaños o capacidades, cada una con su propio precio y cantidad.</span>
          </span>
        </label>

        {!hasVariants ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {costInputs(single, setSingle, "")}
              <div>
                <Label htmlFor="salePrice">{priceLabel}</Label>
                <input id="salePrice" inputMode="decimal" placeholder="Ej.: 80.200" className={cx(field, "h-12 text-lg")} value={single.salePrice} onChange={(e) => setSingle({ salePrice: e.target.value })} />
                <Hint>{priceHint}</Hint>
              </div>
              {pricing.wholesaleEnabled && (
                <>
                  {wholesaleMarkupInput(single, setSingle, "")}
                  <div>
                    <Label htmlFor="wholesalePrice">{taxIncluded ? "Precio mayorista (con IVA)" : "Precio mayorista (sin IVA)"}</Label>
                    <input
                      id="wholesalePrice"
                      inputMode="decimal"
                      className={cx(field, wholesaleCalc(single) && "bg-bg")}
                      value={shownWholesale(single)}
                      readOnly={Boolean(wholesaleCalc(single))}
                      onChange={(e) => setSingle({ wholesalePrice: e.target.value })}
                    />
                    {wholesaleCalc(single) && <Hint>Calculado: lo que te cuesta + valor agregado = {formatMoney(Number(wholesaleCalc(single)), currency)} sin IVA.</Hint>}
                  </div>
                  <div>
                    <Label htmlFor="wholesaleMinQty">Cantidad mínima para precio mayorista</Label>
                    <input id="wholesaleMinQty" inputMode="decimal" placeholder="Ej.: 6" className={field} value={single.wholesaleMinQty} onChange={(e) => setSingle({ wholesaleMinQty: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            <PricePreview v={single} c={retail(single)} taxRate={taxRate} currency={currency} autoValue={pricing.retailAutoEnabled ? estimate(single, pricing, effRetail) : null} />
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-bg p-4">
              <p className="mb-2 text-sm font-medium">¿En qué se diferencian las presentaciones?</p>
              <div className="space-y-2">
                {options.map((o, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                    <input aria-label="Característica" placeholder="Ej.: Tamaño" className={field} value={o.name} onChange={(e) => setOptions((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <input
                      aria-label="Opciones separadas por coma"
                      placeholder="Ej.: 30 ml, 50 ml, 100 ml"
                      className={field}
                      value={o.values}
                      onChange={(e) => setOptions((p) => p.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))}
                    />
                    <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOptions((p) => p.filter((_, j) => j !== i))} disabled={options.length === 1}>
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setOptions((o) => [...o, { name: "", values: "" }])} disabled={options.length >= 3}>
                  Agregar otra característica
                </button>
                <button type="button" className={buttonClass("primary", "sm")} onClick={generate}>
                  Crear las presentaciones
                </button>
              </div>
              <Hint>Escribe las opciones separadas por comas y pulsa «Crear las presentaciones».</Hint>
            </div>

            {variants.map((v, i) => {
              const title = optionNames.map((n) => v.optionValues[n]).filter(Boolean).join(" / ") || `Presentación ${i + 1}`;
              return (
                <fieldset key={v.id ?? `new-${i}`} className="rounded-lg border border-border p-4">
                  <legend className="px-1 font-medium">{title}</legend>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {optionNames.map((n) => (
                      <div key={n}>
                        <Label htmlFor={`opt-${i}-${n}`}>{n}</Label>
                        <input id={`opt-${i}-${n}`} className={field} value={v.optionValues[n] ?? ""} onChange={(e) => setVariant(i, { optionValues: { ...v.optionValues, [n]: e.target.value } })} />
                      </div>
                    ))}
                    {costInputs(v, (patch) => setVariant(i, patch), `-${i}`)}
                    <div>
                      <Label htmlFor={`price-${i}`}>{priceLabel}</Label>
                      <input id={`price-${i}`} aria-label={`Precio presentación ${i + 1}`} inputMode="decimal" className={field} value={v.salePrice} onChange={(e) => setVariant(i, { salePrice: e.target.value })} />
                      <Hint>{priceHint}</Hint>
                    </div>
                    {pricing.wholesaleEnabled && (
                      <>
                        {wholesaleMarkupInput(v, (patch) => setVariant(i, patch), `-${i}`)}
                        <div>
                          <Label htmlFor={`wprice-${i}`}>Precio mayorista</Label>
                          <input
                            id={`wprice-${i}`}
                            inputMode="decimal"
                            className={cx(field, wholesaleCalc(v) && "bg-bg")}
                            value={shownWholesale(v)}
                            readOnly={Boolean(wholesaleCalc(v))}
                            onChange={(e) => setVariant(i, { wholesalePrice: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`wmin-${i}`}>Mínimo mayorista</Label>
                          <input id={`wmin-${i}`} inputMode="decimal" className={field} value={v.wholesaleMinQty} onChange={(e) => setVariant(i, { wholesaleMinQty: e.target.value })} />
                        </div>
                      </>
                    )}
                    {!isEdit && canSetStock && (
                      <div>
                        <Label htmlFor={`stock-${i}`}>Unidades que tienes hoy</Label>
                        <input id={`stock-${i}`} inputMode="decimal" className={field} value={v.initialStock} onChange={(e) => setVariant(i, { initialStock: e.target.value })} />
                      </div>
                    )}
                    <div>
                      <Label htmlFor={`low-${i}`}>Avísame cuando queden</Label>
                      <input id={`low-${i}`} inputMode="decimal" className={field} value={v.lowStockThreshold} onChange={(e) => setVariant(i, { lowStockThreshold: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`barcode-${i}`}>Código de barras</Label>
                      <input id={`barcode-${i}`} className={field} value={v.barcode} onChange={(e) => setVariant(i, { barcode: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`sku-${i}`}>Código interno (SKU)</Label>
                      <input id={`sku-${i}`} className={field} value={v.sku} placeholder="Automático" onChange={(e) => setVariant(i, { sku: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`ref-${i}`}>Código de referencia</Label>
                      <input id={`ref-${i}`} className={field} value={v.referenceCode} onChange={(e) => setVariant(i, { referenceCode: e.target.value })} />
                    </div>
                  </div>
                  <div className="mt-3">
                    <PricePreview v={v} c={retail(v)} taxRate={taxRate} currency={currency} autoValue={pricing.retailAutoEnabled ? estimate(v, pricing, effRetail) : null} />
                  </div>
                  <div className="mt-3 text-right">
                    <button type="button" className={buttonClass("ghost", "sm")} disabled={variants.length === 1} onClick={() => setVariants((p) => p.filter((_, j) => j !== i))}>
                      {v.id ? "Dejar de vender esta presentación" : "Quitar"}
                    </button>
                  </div>
                </fieldset>
              );
            })}
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setVariants((v) => [...v, blank()])}>
              Agregar presentación manualmente
            </button>
          </div>
        )}
        <VariantErrors />
        <Hint>Escribe los valores como de costumbre: 1.599.000 o 2,5.</Hint>
      </section>

      {/* 3. Fotos */}
      <section className="space-y-2 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">3. Fotos</h2>
        <Label htmlFor="image">{isEdit ? "Agregar fotos" : "Elige una o varias fotos"}</Label>
        <input id="image" name="image" type="file" multiple accept="image/png,image/jpeg,image/webp" className="block text-sm" />
        <Hint>JPG, PNG o WEBP de máximo 2 MB cada una. La primera será la principal; el orden se cambia en la ficha del producto.</Hint>
        <FieldError name="image" />
      </section>

      {/* 4. Inventario y códigos (las presentaciones los tienen en su propio recuadro) */}
      {!hasVariants && (
        <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold">4. Inventario y códigos</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {!isEdit && canSetStock && (
              <div>
                <Label htmlFor="initialStock">¿Cuántas unidades tienes hoy?</Label>
                <input id="initialStock" inputMode="decimal" placeholder="Ej.: 5" className={field} value={single.initialStock} onChange={(e) => setSingle({ initialStock: e.target.value })} />
                <Hint>Se registran en tu bodega principal. Puedes dejarlo vacío.</Hint>
              </div>
            )}
            <div>
              <Label htmlFor="lowStock">Avísame cuando queden</Label>
              <input id="lowStock" inputMode="decimal" placeholder="Ej.: 2" className={field} value={single.lowStockThreshold} onChange={(e) => setSingle({ lowStockThreshold: e.target.value })} />
              <Hint>Te mostraremos una alerta cuando haya esta cantidad o menos.</Hint>
            </div>
            <div>
              <Label htmlFor="barcode">Código de barras</Label>
              <input id="barcode" className={field} value={single.barcode} onChange={(e) => setSingle({ barcode: e.target.value })} placeholder="Escanéalo o escríbelo (opcional)" />
            </div>
            <div>
              <Label htmlFor="sku">Código interno (SKU)</Label>
              <input id="sku" className={field} value={single.sku} onChange={(e) => setSingle({ sku: e.target.value })} placeholder="Se crea solo si lo dejas vacío" />
            </div>
            <div>
              <Label htmlFor="referenceCode">Código de referencia</Label>
              <input id="referenceCode" className={field} value={single.referenceCode} onChange={(e) => setSingle({ referenceCode: e.target.value })} placeholder="Del proveedor o fabricante (opcional)" />
            </div>
          </div>
        </section>
      )}

      {/* Más opciones */}
      <details className="rounded-xl border border-border bg-surface p-5" open={Boolean(initial.description || initial.supplierName || initial.retailMargin || initial.wholesaleMargin)}>
        <summary className="cursor-pointer text-base font-semibold">Más opciones (descripción, proveedor, ficha técnica…)</summary>
        <div className="mt-4 space-y-4">
          <div>
            <Label htmlFor="description">Descripción</Label>
            <textarea id="description" name="description" defaultValue={initial.description} className={cx(inputClass, "h-auto min-h-20 py-2")} maxLength={4000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="supplierName">Proveedor habitual</Label>
              <input id="supplierName" name="supplierName" list="supplier-list" defaultValue={initial.supplierName} className={field} placeholder="Opcional" />
              <datalist id="supplier-list">
                {suppliers.map((sup) => (
                  <option key={sup.id} value={sup.name} />
                ))}
              </datalist>
              <FieldError name="supplierName" />
            </div>
            <div>
              <Label htmlFor="unit">Se vende por</Label>
              <input id="unit" name="unit" defaultValue={initial.unit} className={field} maxLength={20} placeholder="unidad, caja, metro…" />
            </div>
            {pricing.retailAutoEnabled && (
              <>
                <div>
                  <Label htmlFor="retailMarginInput" hint={`vacío = ${pricing.retailMargin} % (categoría o general)`}>
                    Margen minorista propio (%)
                  </Label>
                  <input id="retailMarginInput" inputMode="decimal" className={field} value={retailMargin} onChange={(e) => setRetailMargin(e.target.value)} />
                  <FieldError name="retailMargin" />
                </div>
                <div>
                  <Label htmlFor="wholesaleMarginInput" hint={`vacío = ${pricing.wholesaleMargin} % (categoría o general)`}>
                    Margen mayorista propio (%)
                  </Label>
                  <input id="wholesaleMarginInput" inputMode="decimal" className={field} value={wholesaleMargin} onChange={(e) => setWholesaleMargin(e.target.value)} />
                  <FieldError name="wholesaleMargin" />
                </div>
              </>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Ficha técnica</p>
            <div className="space-y-2">
              {attributes.map((a, i) =>
                profileKeys.has(a.key.toLowerCase()) ? null : (
                  <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                    <input aria-label="Dato" placeholder="Ej.: Tipo de piel" className={field} value={a.key} onChange={(e) => setAttributes((p) => p.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                    <input aria-label="Valor" placeholder="Ej.: Grasa" className={field} value={a.value} onChange={(e) => setAttributes((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                    <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setAttributes((p) => p.filter((_, j) => j !== i))}>
                      Quitar
                    </button>
                  </div>
                ),
              )}
            </div>
            <button type="button" className={cx(buttonClass("secondary", "sm"), "mt-2")} onClick={() => setAttributes((a) => [...a, { key: "", value: "" }])}>
              Agregar dato
            </button>
          </div>
        </div>
      </details>

      {payloadList.some((v) => v.salePrice || v.wholesalePrice || wholesaleCalc(v)) && (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
          {pricing.retailAutoEnabled && (
            <>
              <p className="text-sm text-muted">Los precios que escribiste quedan fijos: los cambios de tasa o de costo no los modificarán hasta que los devuelvas a automático.</p>
              <div>
                <Label htmlFor="priceReason">Motivo del precio (opcional, queda en el historial)</Label>
                <input id="priceReason" name="priceReason" className={field} maxLength={300} placeholder="Ej.: precio de lanzamiento" />
              </div>
            </>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="acceptBelowCost" className="mt-0.5 h-4 w-4" />
            <span>Si algún precio queda por debajo de lo que me cuesta, lo acepto.</span>
          </label>
          <FieldError name="acceptBelowCost" />
        </section>
      )}

      <div className="sticky bottom-0 -mx-1 flex justify-end bg-bg/90 px-1 py-3 backdrop-blur">
        <SubmitButton className="h-12 min-w-48 text-base">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
