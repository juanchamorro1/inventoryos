import { describe, expect, it } from "vitest";
import { addLine, parseCart, priceCart, type CartVariantInfo } from "@/lib/cart";
import { orderMessage, whatsappUrl } from "@/lib/whatsapp";

const info = new Map<string, CartVariantInfo>([
  ["A", { sku: "A", productId: "p1", label: "Arroz", currency: "COP", price: "0.10", inStock: true }],
  ["B", { sku: "B", productId: "p2", label: "Bolsa", currency: "COP", price: "0.20", inStock: false }],
]);

describe("carrito", () => {
  it("ignora datos guardados con forma inválida y limita cantidades", () => {
    expect(parseCart("no es json")).toEqual([]);
    expect(parseCart('{"sku":"A"}')).toEqual([]);
    expect(parseCart('[{"sku":"A","quantity":5000},{"sku":3},{"sku":"B","quantity":-2}]')).toEqual([
      { sku: "A", quantity: 999 },
      { sku: "B", quantity: 1 },
    ]);
  });

  it("suma cantidades del mismo SKU", () => {
    expect(addLine(addLine([], "A", 2), "A", 3)).toEqual([{ sku: "A", quantity: 5 }]);
  });

  it("calcula el total en decimal exacto, sin agotados y sin productos retirados", () => {
    const r = priceCart(
      [
        { sku: "A", quantity: 3 },
        { sku: "B", quantity: 1 },
        { sku: "Z", quantity: 1 },
      ],
      info,
    );
    expect(r.total.toString()).toBe("0.3"); // con Number sería 0.30000000000000004
    expect(r.available.map((i) => i.sku)).toEqual(["A"]);
    expect(r.removed).toBe(1);
  });
});

describe("WhatsApp", () => {
  it("arma el mensaje del pedido y el enlace wa.me", () => {
    const r = priceCart([{ sku: "A", quantity: 2 }], info);
    const msg = orderMessage(r.available, r.total, { name: "Ana", notes: "  " });
    expect(msg).toContain("• 2 × Arroz [A]");
    expect(msg).toContain("Nombre: Ana");
    expect(msg).not.toContain("Notas");
    const url = whatsappUrl("+57 300 123 4567", msg);
    expect(url.startsWith("https://wa.me/573001234567?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe(msg);
  });
});
