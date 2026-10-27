"use client";

import { useSyncExternalStore } from "react";
import { addLine, clampQty, parseCart, type CartLine } from "@/lib/cart";

// Carrito en localStorage (por navegador). Solo guarda SKU y cantidad; los precios se leen siempre del catálogo vigente.
const KEY = "storefront-cart-v1";
const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cached: CartLine[] = EMPTY;

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function snapshot(): CartLine[] {
  const raw = read();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseCart(raw);
  }
  return cached;
}

function write(lines: CartLine[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Navegación privada o almacenamiento bloqueado: el carrito vive solo en esta página.
    cachedRaw = JSON.stringify(lines);
    cached = lines;
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCart() {
  const lines = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  return {
    lines,
    count: lines.reduce((n, l) => n + l.quantity, 0),
    add: (sku: string, quantity: number) => write(addLine(snapshot(), sku, quantity)),
    setQuantity: (sku: string, quantity: number) => write(snapshot().map((l) => (l.sku === sku ? { sku, quantity: clampQty(quantity) } : l))),
    remove: (sku: string) => write(snapshot().filter((l) => l.sku !== sku)),
    clear: () => write([]),
  };
}
