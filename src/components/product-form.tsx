"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";
import { toDisplayNumber } from "@/lib/parse-number";
import { ActionForm, FieldError, SubmitButton, useFormState } from "./form";
import { buttonClass, cx, Hint, inputClass, Label } from "./ui";

type Variant = {
  id?: string;
  sku: string;
  barcode: string;
  name: string;
  optionValues: Record<string, string>;
  costPrice: string;
  salePrice: string;
  lowStockThreshold: string;
  initialStock: string;
};

export type ProductFormValues = {
  productId?: string;
  name: string;
  description: string;
  categoryName: string;
  brandName: string;
  taxRateId: string;
  unit: string;
  imagePath?: string | null;
  attributes: Record<string, string>;
  options: { name: string; values: string[] }[];
  variants: Omit<Variant, "initialStock">[];
};

type Choice = { id: string; name: string };

const blank = (): Variant => ({ sku: "", barcode: "", name: "", optionValues: {}, costPrice: "", salePrice: "", lowStockThreshold: "", initialStock: "" });

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

function PriceHelp({ price, cost, taxRate, currency }: { price: string; cost: string; taxRate: number; currency: string }) {
  const p = toDisplayNumber(price);
  const c = toDisplayNumber(cost);
  if (!p) return null;
  const gain = p - c;
  return (
    <p className={cx("mt-1 text-xs", gain < 0 ? "text-danger" : "text-muted")}>
      Precio al cliente con impuesto: <strong>{formatMoney(p * (1 + taxRate / 100), currency)}</strong>
      {c > 0 && (
        <>
          {" "}
          · Ganas {formatMoney(gain, currency)} por unidad ({((gain / p) * 100).toFixed(0)} %)
        </>
      )}
    </p>
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
}) {
  const isEdit = Boolean(initial.productId);
  const [name, setName] = useState(initial.name);
  const [taxRateId, setTaxRateId] = useState(isEdit ? initial.taxRateId : initial.taxRateId || (taxRates.find((t) => t.isDefault)?.id ?? ""));
  const [hasVariants, setHasVariants] = useState(initial.variants.length > 1 || initial.options.length > 0);
  const [options, setOptions] = useState(initial.options.length ? initial.options.map((o) => ({ name: o.name, values: o.values.join(", ") })) : [{ name: "Color", values: "" }]);
  const [variants, setVariants] = useState<Variant[]>(initial.variants.length ? initial.variants.map((v) => ({ ...v, initialStock: "" })) : [blank()]);
  const [attributes, setAttributes] = useState(Object.entries(initial.attributes).map(([key, value]) => ({ key, value })));
  const taxRate = Number(taxRates.find((t) => t.id === taxRateId)?.rate ?? 0);

  const optionDefs = options.map((o) => ({ name: o.name.trim(), values: o.values.split(",").map((v) => v.trim()).filter(Boolean) })).filter((o) => o.name);
  const optionNames = hasVariants ? optionDefs.map((o) => o.name) : [];
  const single = variants[0] ?? blank();
  const setSingle = (patch: Partial<Variant>) => setVariants((p) => [{ ...(p[0] ?? blank()), ...patch }, ...p.slice(1)]);
  const setVariant = (i: number, patch: Partial<Variant>) => setVariants((p) => p.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  // Se calcula en cada render: es barato y evita memoizaciones frágiles.
  const payloadList = hasVariants ? variants : variants.slice(0, 1);
  const payloadVariants = JSON.stringify(
    payloadList.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        sku: v.sku,
        barcode: v.barcode || null,
        name: v.name,
        optionValues: hasVariants ? Object.fromEntries(optionNames.map((n) => [n, v.optionValues[n] ?? ""]).filter(([, x]) => x)) : {},
        costPrice: v.costPrice || "0",
        salePrice: v.salePrice || "0",
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
        .map((c) => ({ ...blank(), optionValues: c, costPrice: base.costPrice, salePrice: base.salePrice, lowStockThreshold: base.lowStockThreshold }));
      return [...keep, ...added];
    });
  }

  const field = cx(inputClass);

  return (
    <ActionForm action={action}>
      {initial.productId && <input type="hidden" name="productId" value={initial.productId} />}
      {initial.imagePath && <input type="hidden" name="previousImage" value={initial.imagePath} />}
      <input type="hidden" name="variants" value={payloadVariants} />
      <input type="hidden" name="options" value={JSON.stringify(hasVariants ? optionDefs : [])} />
      <input type="hidden" name="attributes" value={JSON.stringify(Object.fromEntries(attributes.filter((a) => a.key.trim()).map((a) => [a.key.trim(), a.value.trim()])))} />
      <input type="hidden" name="taxRateId" value={taxRateId} />

      {/* 1. Lo básico */}
      <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-base font-semibold">1. ¿Qué producto es?</h2>
        <div>
          <Label htmlFor="name">Nombre del producto *</Label>
          <input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Samsung Galaxy A55" className={field} />
          <FieldError name="name" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="categoryName">Categoría</Label>
            <input id="categoryName" name="categoryName" list="category-list" defaultValue={initial.categoryName} placeholder="Ej.: Celulares" className={field} />
            <datalist id="category-list">
              {categories.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            <Hint>Elige una o escribe una nueva.</Hint>
          </div>
          <div>
            <Label htmlFor="brandName">Marca</Label>
            <input id="brandName" name="brandName" list="brand-list" defaultValue={initial.brandName} placeholder="Ej.: Samsung" className={field} />
            <datalist id="brand-list">
              {brands.map((b) => (
                <option key={b.id} value={b.name} />
              ))}
            </datalist>
          </div>
        </div>
      </section>

      {/* 2. Precio y cantidades */}
      <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-base font-semibold">2. Precio y cantidades</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="tax">Impuesto que cobras al vender</Label>
            <select id="tax" value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)} className={field}>
              <option value="">Sin impuesto</option>
              {taxRates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={hasVariants} onChange={(e) => setHasVariants(e.target.checked)} />
          <span>
            <span className="font-medium">Este producto viene en varias presentaciones</span>
            <span className="block text-muted">Por ejemplo colores, tallas o capacidades, cada una con su propio precio y cantidad.</span>
          </span>
        </label>

        {!hasVariants ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="salePrice">Precio de venta (sin impuesto) *</Label>
              <input id="salePrice" inputMode="decimal" placeholder="Ej.: 1.599.000" className={field} value={single.salePrice} onChange={(e) => setSingle({ salePrice: e.target.value })} />
              <PriceHelp price={single.salePrice} cost={single.costPrice} taxRate={taxRate} currency={currency} />
            </div>
            <div>
              <Label htmlFor="costPrice">¿Cuánto te cuesta a ti?</Label>
              <input id="costPrice" inputMode="decimal" placeholder="Ej.: 1.200.000" className={field} value={single.costPrice} onChange={(e) => setSingle({ costPrice: e.target.value })} />
              <Hint>Lo que pagas al proveedor por unidad. Sirve para calcular tu ganancia.</Hint>
            </div>
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
              <Hint>Un código corto para identificar el producto, por ejemplo A55-NEGRO.</Hint>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-bg p-4">
              <p className="mb-2 text-sm font-medium">¿En qué se diferencian las presentaciones?</p>
              <div className="space-y-2">
                {options.map((o, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                    <input aria-label="Característica" placeholder="Ej.: Color" className={field} value={o.name} onChange={(e) => setOptions((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <input
                      aria-label="Opciones separadas por coma"
                      placeholder="Ej.: Negro, Azul, Blanco"
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
                    <div>
                      <Label htmlFor={`price-${i}`}>Precio de venta *</Label>
                      <input id={`price-${i}`} aria-label={`Precio presentación ${i + 1}`} inputMode="decimal" className={field} value={v.salePrice} onChange={(e) => setVariant(i, { salePrice: e.target.value })} />
                      <PriceHelp price={v.salePrice} cost={v.costPrice} taxRate={taxRate} currency={currency} />
                    </div>
                    <div>
                      <Label htmlFor={`cost-${i}`}>Te cuesta</Label>
                      <input id={`cost-${i}`} inputMode="decimal" className={field} value={v.costPrice} onChange={(e) => setVariant(i, { costPrice: e.target.value })} />
                    </div>
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
        <Hint>Puedes escribir los valores como de costumbre: 1.599.000 o 2,5.</Hint>
      </section>

      {/* 3. Opcional */}
      <details className="rounded-xl border border-border bg-surface p-5" open={Boolean(initial.description || Object.keys(initial.attributes).length || initial.imagePath)}>
        <summary className="cursor-pointer text-base font-semibold">3. Más detalles (opcional)</summary>
        <div className="mt-4 space-y-4">
          <div>
            <Label htmlFor="description">Descripción</Label>
            <textarea id="description" name="description" defaultValue={initial.description} className={cx(inputClass, "h-auto min-h-20 py-2")} maxLength={4000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="image">Foto</Label>
              <input id="image" name="image" type="file" accept="image/png,image/jpeg,image/webp" className="block text-sm" />
              <Hint>JPG, PNG o WEBP de máximo 2 MB.</Hint>
              <FieldError name="image" />
            </div>
            <div>
              <Label htmlFor="unit">Se vende por</Label>
              <input id="unit" name="unit" defaultValue={initial.unit} className={field} maxLength={20} placeholder="unidad, caja, metro…" />
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Ficha técnica</p>
            <div className="space-y-2">
              {attributes.map((a, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                  <input aria-label="Dato" placeholder="Ej.: Pantalla" className={field} value={a.key} onChange={(e) => setAttributes((p) => p.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                  <input aria-label="Valor" placeholder='Ej.: 6,6"' className={field} value={a.value} onChange={(e) => setAttributes((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setAttributes((p) => p.filter((_, j) => j !== i))}>
                    Quitar
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className={cx(buttonClass("secondary", "sm"), "mt-2")} onClick={() => setAttributes((a) => [...a, { key: "", value: "" }])}>
              Agregar dato
            </button>
          </div>
        </div>
      </details>

      <div className="flex justify-end">
        <SubmitButton className="min-w-40">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
