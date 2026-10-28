import { describe, expect, it } from "vitest";
import { fetchAllProducts, filterProducts, isSort, listBrands, listCategories, toStoreProduct, type ApiProduct } from "@/lib/catalog-map";

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

  it("publica el mayorista sin IVA y lo oculta si no es más barato que el detal", () => {
    const retail = { net: "68907.56", taxRate: "19", gross: "82000.00" };
    const variant = (wholesaleNet: string) => ({
      sku: "DRA-RET",
      barcode: null,
      name: "",
      options: {},
      prices: { currency: "COP", retail, wholesale: { net: wholesaleNet, taxRate: "19", gross: "0", minQuantity: "10" } },
    });
    // Caso real: costo 68.832 + 9,5 % = 75.371,04 sin IVA, frente a 82.000 al detal con IVA.
    expect(toStoreProduct(product({ variants: [variant("75371.04")] }))!.variants[0]!.wholesale).toEqual({ price: "75371.04", minQuantity: "10" });
    expect(toStoreProduct(product({ variants: [variant("82000.00")] }))!.variants[0]!.wholesale).toBeNull();
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

  // Tres productos de un solo precio para probar marca, orden, disponibilidad y rango.
  const one = (id: string, name: string, brand: string | null, gross: string, stock: string, updatedAt: string) =>
    toStoreProduct(
      product({
        id: `0000000${id}-0000-4000-8000-000000000000`,
        name,
        brand,
        updatedAt,
        variants: [{ sku: name, barcode: null, name: "", options: {}, prices: { currency: "COP", retail: price(gross), wholesale: null }, availability: { total: stock } }],
      }),
    )!;
  const a = one("1", "Ampolla", "SKIN1004", "94300.00", "2", "2026-10-01T00:00:00.000Z");
  const b = one("2", "Bálsamo", "Dr. Althea", "27400.00", "0", "2026-10-20T00:00:00.000Z");
  const c = one("3", "Crema", "Dr. Althea", "62900.00", "5", "2026-10-10T00:00:00.000Z");
  const names = (f: Parameters<typeof filterProducts>[1]) => filterProducts([c, a, b], f).map((p) => p.name);

  it("filtra por marca sin importar mayúsculas ni tildes y lista las marcas", () => {
    expect(names({ brand: "dr. althea" })).toEqual(["Crema", "Bálsamo"]);
    expect(listBrands([c, a, b, te])).toEqual(["Dr. Althea", "SKIN1004"]);
  });

  it("ordena por precio, nombre y fecha (decimal exacto, no texto)", () => {
    expect(names({ sort: "precio-asc" })).toEqual(["Bálsamo", "Crema", "Ampolla"]);
    expect(names({ sort: "precio-desc" })).toEqual(["Ampolla", "Crema", "Bálsamo"]);
    expect(names({ sort: "nombre" })).toEqual(["Ampolla", "Bálsamo", "Crema"]);
    expect(names({ sort: "recientes" })).toEqual(["Bálsamo", "Crema", "Ampolla"]);
  });

  it("filtra solo disponibles y por rango de precio escrito con puntos o $", () => {
    expect(names({ onlyAvailable: true, sort: "nombre" })).toEqual(["Ampolla", "Crema"]);
    expect(names({ minPrice: "$ 30.000", maxPrice: "70000" })).toEqual(["Crema"]);
    expect(names({ maxPrice: "abc", sort: "nombre" })).toEqual(["Ampolla", "Bálsamo", "Crema"]);
  });

  it("solo acepta órdenes conocidos", () => {
    expect(isSort("precio-asc")).toBe(true);
    expect(isSort("toString")).toBe(false);
    expect(isSort(undefined)).toBe(false);
  });
});
