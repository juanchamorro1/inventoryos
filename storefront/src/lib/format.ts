import type Decimal from "decimal.js";

// Solo para mostrar: los cálculos se hacen con decimal.js.
export function formatMoney(value: string | Decimal, currency = "COP") {
  const n = Number(value.toString());
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: currency === "COP" ? 0 : 2 }).format(n);
}

/** Nombre corto de una opción para el selector: «Talla: M, Color: Rojo», o el nombre de la variante. */
export function optionLabel(productName: string, v: { sku: string; name: string; options: Record<string, string> }) {
  const opts = Object.entries(v.options).map(([k, val]) => `${k}: ${val}`).join(", ");
  return opts || (v.name && v.name !== productName ? v.name : v.sku);
}

export function variantLabel(productName: string, v: { name: string; options: Record<string, string> }) {
  const opts = Object.entries(v.options).map(([k, val]) => `${k}: ${val}`).join(", ");
  if (opts) return `${productName} (${opts})`;
  return v.name && v.name !== productName ? `${productName} (${v.name})` : productName;
}
