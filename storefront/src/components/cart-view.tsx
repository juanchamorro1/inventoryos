"use client";

import Link from "next/link";
import { useState } from "react";
import { MAX_QTY, priceCart, type CartVariantInfo } from "@/lib/cart";
import { formatMoney } from "@/lib/format";
import { orderMessage, whatsappUrl } from "@/lib/whatsapp";
import { useCart } from "./cart-store";

export function CartView({ variants, whatsapp }: { variants: CartVariantInfo[]; whatsapp: string }) {
  const cart = useCart();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const { items, available, total, currency, removed } = priceCart(cart.lines, new Map(variants.map((v) => [v.sku, v])));

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-muted">Tu carrito está vacío.</p>
        <Link href="/" className="mt-4 inline-block font-medium text-primary underline">Ver productos</Link>
      </div>
    );
  }

  const href = whatsapp ? whatsappUrl(whatsapp, orderMessage(available, total, { name, notes })) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <ul className="divide-y divide-border self-start rounded-xl border border-border bg-surface">
        {items.map((i) => (
          <li key={i.sku} className="flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <Link href={`/p/${i.productId}`} className="font-medium hover:underline">{i.label}</Link>
              <p className="text-xs text-muted">SKU {i.sku} · {formatMoney(i.price, i.currency)} c/u</p>
              {i.inStock === false && <p className="text-sm font-medium text-danger">Agotado: no se incluirá en el pedido</p>}
            </div>
            <input
              type="number"
              min={1}
              max={MAX_QTY}
              value={i.quantity}
              aria-label={`Cantidad de ${i.label}`}
              onChange={(e) => cart.setQuantity(i.sku, Number(e.target.value))}
              className="num w-20 rounded-lg border border-border px-3 py-2"
            />
            <p className="num w-28 text-right font-medium">{formatMoney(i.subtotal, i.currency)}</p>
            <button type="button" onClick={() => cart.remove(i.sku)} className="text-sm text-muted hover:text-danger">Quitar</button>
          </li>
        ))}
      </ul>

      <aside className="space-y-4 self-start rounded-xl border border-border bg-surface p-5">
        {removed > 0 && <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">Algunos productos ya no están en el catálogo y se quitaron.</p>}
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Total estimado</span>
          <span className="num text-2xl font-semibold">{formatMoney(total, currency)}</span>
        </div>
        <p className="text-xs text-muted">Precios con IVA incluido. La tienda confirma disponibilidad, envío y total por WhatsApp.</p>
        <label className="block text-sm">
          Tu nombre (opcional)
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-border px-3 py-2" />
        </label>
        <label className="block text-sm">
          Notas (opcional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} rows={3} className="mt-1 w-full rounded-lg border border-border px-3 py-2" />
        </label>
        {href && available.length > 0 ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-[#1f9d55] px-5 py-3 text-center font-medium text-white hover:bg-[#178246]">
            Enviar pedido por WhatsApp
          </a>
        ) : (
          <p className="text-sm text-muted">{href ? "No hay productos disponibles en el carrito." : "La tienda aún no configuró su WhatsApp."}</p>
        )}
        <button type="button" onClick={cart.clear} className="w-full text-sm text-muted hover:text-danger">Vaciar carrito</button>
      </aside>
    </div>
  );
}
