import { describe, expect, it } from "vitest";
import { fetchAllProducts, filterProducts, listCategories, toStoreProduct, type ApiProduct } from "@/lib/catalog-map";

const price = (gross: string) => ({ net: gross, taxRate: "0", gross });

function product(over: Partial<ApiProduct> = {}): ApiProduct {
  return {
    id: "8f6b1a3e-2c4d-4e5f-9a0b-1c2d3e4f5a6b",
    name: "Café de Nariño",
    description: null,
    category: "Bebidas",
    brand: "Origen",
    unit: "und",
    attributes: {},
    images: [
      { id: "11111111-1111-4111-8111-111111111111", url: "/api/v1/images/1", alt: "", primary: false, position: 0 },
      { id: "22222222-2222-4222-8222-222222222222", url: "/api/v1/images/2", alt: "Bolsa", primary: true, position: 1 },
    ],
    variants: [
      { sku: "CAF-500", barcode: null, name: "500 g", options: {}, prices: { currency: "COP", retail: price("32000.00"), wholesale: null }, availability: { total: "0.0000" } },
      { sku: "CAF-250", barcode: null, name: "250 g", options: {}, prices: { currency: "COP", retail: price("18000.00"), wholesale: { ...price("15000.00"), minQuantity: "12" } }, availability: { total: "3.5000" } },
    ],
    updatedAt: "2026-10-27T00:00:00.000Z",
    ...over,
  };
}

describe("toStoreProduct", () => {
  it("reduce el stock a disponible/agotado sin exponer cantidades", () => {
    const p = toStoreProduct(product())!;
    expect(p.variants.map((v) => v.inStock)).toEqual([false, true]);
    expect(p.inStock).toBe(true);
    expect(JSON.stringify(p)).not.toContain("3.5");
  });

  it("usa el precio con IVA más bajo como «desde» y pone la foto principal primero", () => {
    const p = toStoreProduct(product())!;
    expect(p.fromPrice).toBe("18000.00");
    expect(p.images.map((i) => i.alt)).toEqual(["Bolsa", "Café de Nariño"]);
    expect(p.variants[1]!.wholesale).toEqual({ price: "15000.00", minQuantity: "12" });
  });

  it("sin permiso inventory:read la disponibilidad es desconocida", () => {
    const base = product();
    const p = toStoreProduct({ ...base, variants: base.variants.map(({ availability: _a, ...v }) => v) })!;
    expect(p.inStock).toBeNull();
  });

  it("omite productos sin variantes publicadas", () => {
    expect(toStoreProduct(product({ variants: [] }))).toBeNull();
  });
});

describe("fetchAllProducts", () => {
  it("recorre las páginas hasta hasMore = false", async () => {
    const pages: number[] = [];
    const out = await fetchAllProducts(async (page) => {
      pages.push(page);
      return { data: [product({ id: `8f6b1a3e-2c4d-4e5f-9a0b-1c2d3e4f5a6${page}` })], page, limit: 1, hasMore: page < 3 };
    });
    expect(pages).toEqual([1, 2, 3]);
    expect(out).toHaveLength(3);
  });

  it("rechaza respuestas que no cumplen el contrato", async () => {
    await expect(fetchAllProducts(async () => ({ data: [{ id: "x" }], page: 1, limit: 1, hasMore: false }))).rejects.toThrow();
  });
});

describe("filterProducts", () => {
  const cafe = toStoreProduct(product())!;
  const te = toStoreProduct(product({ id: "9f6b1a3e-2c4d-4e5f-9a0b-1c2d3e4f5a6b", name: "Té verde", category: "Infusiones", brand: null, variants: [product().variants[0]!] }))!;

  it("busca sin tildes ni mayúsculas, también por SKU", () => {
    expect(filterProducts([cafe, te], { q: "CAFE" })).toEqual([cafe]);
    expect(filterProducts([cafe, te], { q: "caf-250" })).toEqual([cafe]);
  });

  it("filtra por categoría y deja los agotados al final", () => {
    expect(filterProducts([te, cafe], {}).map((p) => p.name)).toEqual(["Café de Nariño", "Té verde"]);
    expect(filterProducts([cafe, te], { category: "infusiones" })).toEqual([te]);
    expect(listCategories([te, cafe])).toEqual(["Bebidas", "Infusiones"]);
  });
});
