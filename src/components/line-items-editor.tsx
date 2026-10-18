"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { searchVariantsAction } from "@/app/actions/lookup";
import type { VariantOption } from "@/server/modules/catalog/service";
import { formatMoney, formatQty } from "@/lib/format";
import { toDisplayNumber } from "@/lib/parse-number";
import { useFormState } from "./form";
import { buttonClass, cx, inputClass } from "./ui";

export type LineMode = "receipt" | "issue" | "adjustment" | "transfer" | "sale" | "purchase";

type Line = {
  variantId: string;
  sku: string;
  label: string;
  available: string | null;
  quantity: string;
  unitCost: string;
  unitPrice: string;
  listPrice: string;
  discount: string;
  taxRate: string;
  counted: string;
};

export type InitialLine = Partial<Line> & { variantId: string; sku: string; label: string };

/** Observa el valor de un campo del mismo formulario (p. ej. la bodega) para consultar disponibilidad. */
function useFormField(anchor: React.RefObject<HTMLElement | null>, name?: string) {
  const [value, setValue] = useState<string>("");
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form || !name) return;
    const read = () => {
      const el = form.elements.namedItem(name);
      setValue(el && "value" in el ? String((el as unknown as HTMLInputElement).value) : "");
    };
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, [anchor, name]);
  return value;
}

const plain = (v: string) => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);

export function LineItemsEditor({
  mode,
  locationField,
  currency = "COP",
  canEditPrice = false,
  initial = [],
  name = "lines",
}: {
  mode: LineMode;
  /** Nombre del campo del formulario con la bodega cuyo disponible se muestra. */
  locationField?: string;
  currency?: string;
  canEditPrice?: boolean;
  initial?: InitialLine[];
  name?: string;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const locationId = useFormField(anchor, locationField);
  const state = useFormState();
  const [lines, setLines] = useState<Line[]>(() =>
    initial.map((l) => ({ available: null, quantity: "1", unitCost: "0", unitPrice: "0", listPrice: "0", discount: "0", taxRate: "0", counted: "", ...l })),
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VariantOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await searchVariantsAction(query, locationId || undefined));
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open, locationId]);

  // Al cambiar de bodega, refresca lo disponible de las líneas existentes.
  useEffect(() => {
    if (!locationId || lines.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates = await Promise.all(lines.map((l) => searchVariantsAction(l.sku, locationId)));
      if (cancelled) return;
      setLines((prev) =>
        prev.map((l, i) => {
          const match = updates[i]?.find((u) => u.variantId === l.variantId);
          return match ? { ...l, available: match.available } : l;
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  function add(v: VariantOption) {
    setLines((prev) => {
      const existing = prev.findIndex((l) => l.variantId === v.variantId);
      if (existing >= 0) return prev.map((l, i) => (i === existing ? { ...l, quantity: String(toDisplayNumber(l.quantity) + 1) } : l));
      return [
        ...prev,
        {
          variantId: v.variantId,
          sku: v.sku,
          label: v.label,
          available: v.available,
          quantity: "1",
          unitCost: plain(v.costPrice),
          unitPrice: plain(v.salePrice),
          listPrice: plain(v.salePrice),
          discount: "0",
          taxRate: plain(v.taxRate),
          counted: v.available !== null ? plain(v.available) : "",
        },
      ];
    });
    setQuery("");
    setOpen(false);
    searchRef.current?.focus();
  }

  const update = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => setLines((prev) => prev.filter((_, j) => j !== i));

  const payload = useMemo(
    () =>
      JSON.stringify(
        lines.map((l) => {
          switch (mode) {
            case "receipt":
              return { variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost };
            case "purchase":
              return { variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost, taxRate: l.taxRate };
            case "adjustment":
              return { variantId: l.variantId, counted: l.counted, ...(l.unitCost && toDisplayNumber(l.unitCost) > 0 ? { unitCost: l.unitCost } : {}) };
            case "sale":
              return canEditPrice ? { variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount || "0" } : { variantId: l.variantId, quantity: l.quantity };
            default:
              return { variantId: l.variantId, quantity: l.quantity };
          }
        }),
      ),
    [lines, mode, canEditPrice],
  );

  const priceOf = (l: Line) => (mode === "sale" ? toDisplayNumber(canEditPrice ? l.unitPrice : l.listPrice) : toDisplayNumber(l.unitCost));
  const subtotalOf = (l: Line) => toDisplayNumber(l.quantity) * priceOf(l) - (mode === "sale" ? toDisplayNumber(l.discount) : 0);
  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const l of lines) {
      const s = subtotalOf(l);
      subtotal += s;
      tax += (s * toDisplayNumber(l.taxRate)) / 100;
    }
    return { subtotal, tax, total: subtotal + tax };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, mode, canEditPrice]);

  const lineError = (i: number, field: string) => state.fieldErrors?.[`lines.${i}.${field}`]?.[0];
  const showAvailable = mode !== "receipt" && mode !== "purchase";
  const numberInput = cx(inputClass, "num text-right");
  const small = "mb-1 block text-xs text-muted";

  return (
    <div ref={anchor} className="space-y-3">
      <input type="hidden" name={name} value={payload} />
      <div className="relative">
        <input
          ref={searchRef}
          type="search"
          aria-label="Buscar producto"
          placeholder="Escribe el nombre del producto o escanea su código de barras…"
          className={cx(inputClass, "h-12 text-base")}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const exact = results.find((r) => r.sku.toLowerCase() === query.trim().toLowerCase() || r.barcode === query.trim());
              if (exact) add(exact);
              else if (results.length === 1) add(results[0]!);
            }
          }}
        />
        {open && (
          <div className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-border bg-surface shadow-lg">
            {loading && results.length === 0 && <p className="px-3 py-3 text-sm text-muted">Buscando…</p>}
            {!loading && results.length === 0 && <p className="px-3 py-3 text-sm text-muted">No encontramos productos con «{query}».</p>}
            {results.map((r) => {
              const out = showAvailable && mode !== "adjustment" && r.available !== null && toDisplayNumber(r.available) <= 0;
              return (
                <button
                  key={r.variantId}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(r)}
                  className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-primary-soft"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.label}</span>
                    <span className="text-xs text-muted">Código {r.sku}</span>
                  </span>
                  <span className="num shrink-0 text-right text-xs">
                    <span className="block">{formatMoney(r.salePrice, currency)}</span>
                    {r.available !== null && <span className={out ? "text-danger" : "text-muted"}>{out ? "Sin unidades aquí" : `Hay ${formatQty(r.available)}`}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Todavía no has agregado productos. Búscalos en el recuadro de arriba.</p>
      ) : (
        <ul className="space-y-2">
          {lines.map((l, i) => {
            const over = showAvailable && mode !== "adjustment" && l.available !== null && toDisplayNumber(l.quantity) > toDisplayNumber(l.available);
            return (
              <li key={l.variantId} className="rounded-lg border border-border bg-surface p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{l.label}</p>
                    <p className="text-xs text-muted">
                      Código {l.sku}
                      {showAvailable && l.available !== null && (
                        <span className={over ? "font-semibold text-danger" : undefined}> · Hay {formatQty(l.available)} en esta bodega</span>
                      )}
                    </p>
                  </div>
                  <button type="button" className={buttonClass("ghost", "sm")} onClick={() => remove(i)} aria-label={`Quitar ${l.sku}`}>
                    Quitar
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {mode === "adjustment" ? (
                    <div>
                      <label className={small} htmlFor={`counted-${i}`}>
                        ¿Cuántas contaste?
                      </label>
                      <input id={`counted-${i}`} aria-label={`Conteo de ${l.sku}`} inputMode="decimal" className={numberInput} value={l.counted} onChange={(e) => update(i, { counted: e.target.value })} />
                      {l.available !== null && l.counted !== "" && (
                        <p className="mt-1 text-xs text-muted">
                          {toDisplayNumber(l.counted) === toDisplayNumber(l.available)
                            ? "Sin diferencia"
                            : toDisplayNumber(l.counted) > toDisplayNumber(l.available)
                              ? `Sobran ${formatQty(toDisplayNumber(l.counted) - toDisplayNumber(l.available))}`
                              : `Faltan ${formatQty(toDisplayNumber(l.available) - toDisplayNumber(l.counted))}`}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className={small} htmlFor={`qty-${i}`}>
                        Cantidad
                      </label>
                      <input id={`qty-${i}`} aria-label={`Cantidad de ${l.sku}`} inputMode="decimal" className={numberInput} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                    </div>
                  )}
                  {(mode === "receipt" || mode === "purchase") && (
                    <div>
                      <label className={small} htmlFor={`cost-${i}`}>
                        Costo por unidad
                      </label>
                      <input id={`cost-${i}`} aria-label={`Costo de ${l.sku}`} inputMode="decimal" className={numberInput} value={l.unitCost} onChange={(e) => update(i, { unitCost: e.target.value })} />
                    </div>
                  )}
                  {mode === "purchase" && (
                    <div>
                      <label className={small} htmlFor={`tax-${i}`}>
                        IVA %
                      </label>
                      <input id={`tax-${i}`} aria-label={`IVA de ${l.sku}`} inputMode="decimal" className={numberInput} value={l.taxRate} onChange={(e) => update(i, { taxRate: e.target.value })} />
                    </div>
                  )}
                  {mode === "sale" && (
                    <div>
                      <span className={small}>Precio c/u</span>
                      {canEditPrice ? (
                        <input aria-label={`Precio de ${l.sku}`} inputMode="decimal" className={numberInput} value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} />
                      ) : (
                        <p className="num flex h-10 items-center justify-end text-sm">{formatMoney(l.listPrice, currency)}</p>
                      )}
                    </div>
                  )}
                  {mode === "sale" && canEditPrice && (
                    <div>
                      <label className={small} htmlFor={`disc-${i}`}>
                        Descuento ($)
                      </label>
                      <input id={`disc-${i}`} aria-label={`Descuento de ${l.sku}`} inputMode="decimal" className={numberInput} value={l.discount} onChange={(e) => update(i, { discount: e.target.value })} />
                    </div>
                  )}
                  {(mode === "sale" || mode === "purchase" || mode === "receipt") && (
                    <div>
                      <span className={small}>Subtotal</span>
                      <p className="num flex h-10 items-center justify-end text-sm font-medium">{formatMoney(subtotalOf(l), currency)}</p>
                    </div>
                  )}
                </div>
                {over && <p className="mt-2 text-xs font-medium text-danger">No hay suficientes unidades en esta bodega.</p>}
                {(lineError(i, "quantity") || lineError(i, "counted") || lineError(i, "unitCost") || lineError(i, "unitPrice") || lineError(i, "discount")) && (
                  <p className="mt-2 text-xs text-danger">
                    {lineError(i, "quantity") ?? lineError(i, "counted") ?? lineError(i, "unitCost") ?? lineError(i, "unitPrice") ?? lineError(i, "discount")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(mode === "sale" || mode === "purchase") && lines.length > 0 && (
        <div className="ml-auto w-full max-w-xs space-y-1 rounded-lg bg-bg p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Subtotal</span>
            <span className="num">{formatMoney(totals.subtotal, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Impuestos</span>
            <span className="num">{formatMoney(totals.tax, currency)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
            <span>Total</span>
            <span className="num">{formatMoney(totals.total, currency)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
