import Decimal from "decimal.js";

export type CartLine = { sku: string; quantity: number };

/** Lo que el carrito necesita saber de cada variante (precio vigente, no el que había al agregarla). */
export type CartVariantInfo = {
  sku: string;
  productId: string;
  label: string;
  currency: string;
  price: string;
  inStock: boolean | null;
};

export const MAX_QTY = 999;

export function clampQty(n: number) {
  return Math.min(Math.max(Math.trunc(Number.isFinite(n) ? n : 1), 1), MAX_QTY);
}

/** Lee el carrito guardado sin confiar en su forma (localStorage puede tener cualquier cosa). */
export function parseCart(raw: string | null): CartLine[] {
  try {
    const data: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(data)) return [];
    const lines = new Map<string, number>();
    for (const l of data) {
      if (l && typeof l === "object" && typeof l.sku === "string" && typeof l.quantity === "number") lines.set(l.sku, clampQty(l.quantity));
    }
    return [...lines].map(([sku, quantity]) => ({ sku, quantity }));
  } catch {
    return [];
  }
}

export function addLine(lines: CartLine[], sku: string, quantity: number): CartLine[] {
  const found = lines.find((l) => l.sku === sku);
  if (found) return lines.map((l) => (l.sku === sku ? { sku, quantity: clampQty(l.quantity + quantity) } : l));
  return [...lines, { sku, quantity: clampQty(quantity) }];
}

/** Cruza el carrito con el catálogo vigente: quita lo que ya no se publica y separa lo agotado. */
export function priceCart(lines: CartLine[], info: Map<string, CartVariantInfo>) {
  const items = lines.flatMap((l) => {
    const v = info.get(l.sku);
    return v ? [{ ...v, quantity: l.quantity, subtotal: new Decimal(v.price).times(l.quantity) }] : [];
  });
  const available = items.filter((i) => i.inStock !== false);
  const total = available.reduce((sum, i) => sum.plus(i.subtotal), new Decimal(0));
  return { items, available, total, currency: items[0]?.currency ?? "COP", removed: lines.length - items.length };
}
