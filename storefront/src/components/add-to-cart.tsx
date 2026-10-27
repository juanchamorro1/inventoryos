"use client";

import Link from "next/link";
import { useState } from "react";
import type { StoreVariant } from "@/lib/catalog-map";
import { clampQty, MAX_QTY } from "@/lib/cart";
import { formatMoney, optionLabel } from "@/lib/format";
import { useCart } from "./cart-store";

export function AddToCart({ productName, variants }: { productName: string; variants: StoreVariant[] }) {
  const cart = useCart();
  const [sku, setSku] = useState(() => (variants.find((v) => v.inStock !== false) ?? variants[0])!.sku);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const variant = variants.find((v) => v.sku === sku) ?? variants[0]!;
  const soldOut = variant.inStock === false;

  return (
    <div className="space-y-4">
      {variants.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-muted">Elige una opción</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <button
                key={v.sku}
                type="button"
                onClick={() => {
                  setSku(v.sku);
                  setAdded(false);
                }}
                aria-pressed={v.sku === sku}
                className={`rounded-lg border px-3 py-2 text-sm ${v.sku === sku ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface hover:border-primary"} ${v.inStock === false ? "text-muted line-through" : ""}`}
              >
                {optionLabel(productName, v)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <p className="num text-3xl font-semibold">{formatMoney(variant.price, variant.currency)}</p>
      {variant.wholesale?.minQuantity && (
        <p className="text-sm text-muted">
          Por mayor desde {variant.wholesale.minQuantity} unidades: <span className="num font-medium text-ink">{formatMoney(variant.wholesale.price, variant.currency)}</span> c/u (se confirma por WhatsApp)
        </p>
      )}
      <Availability inStock={variant.inStock} />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Cantidad
          <input
            type="number"
            min={1}
            max={MAX_QTY}
            value={qty}
            onChange={(e) => setQty(clampQty(Number(e.target.value)))}
            className="num w-20 rounded-lg border border-border bg-surface px-3 py-2"
          />
        </label>
        <button
          type="button"
          disabled={soldOut}
          onClick={() => {
            cart.add(variant.sku, qty);
            setAdded(true);
          }}
          className="rounded-lg bg-primary px-5 py-2.5 font-medium text-white hover:bg-primary-strong disabled:cursor-not-allowed disabled:bg-border disabled:text-muted"
        >
          {soldOut ? "Agotado" : "Agregar al carrito"}
        </button>
      </div>
      {added && (
        <p className="text-sm text-success" role="status">
          Agregado. <Link href="/carrito" className="font-medium underline">Ver carrito</Link>
        </p>
      )}
    </div>
  );
}

export function Availability({ inStock }: { inStock: boolean | null }) {
  if (inStock === null) return null;
  return inStock ? (
    <span className="inline-block rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">Disponible</span>
  ) : (
    <span className="inline-block rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-medium text-danger">Agotado</span>
  );
}
