import type Decimal from "decimal.js";
import { formatMoney } from "./format";

type Item = { label: string; sku: string; quantity: number; subtotal: Decimal; currency: string };

/** Arma el mensaje del pedido. Es una solicitud: la tienda confirma disponibilidad y total por WhatsApp. */
export function orderMessage(items: Item[], total: Decimal, customer: { name?: string; notes?: string } = {}) {
  const currency = items[0]?.currency ?? "COP";
  const lines = [
    "Hola, quiero hacer este pedido:",
    "",
    ...items.map((i) => `• ${i.quantity} × ${i.label} [${i.sku}] — ${formatMoney(i.subtotal, currency)}`),
    "",
    `Total estimado: ${formatMoney(total, currency)}`,
  ];
  const name = customer.name?.trim();
  const notes = customer.notes?.trim();
  if (name) lines.push(`Nombre: ${name}`);
  if (notes) lines.push(`Notas: ${notes}`);
  lines.push("", "¿Me confirman disponibilidad y el total?");
  return lines.join("\n");
}

export function whatsappUrl(phone: string, message: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}
