import Decimal from "decimal.js";
import { z } from "zod";

// Contrato v1 de InventoryOS (GET /api/v1/catalog). Se valida al recibirlo: si InventoryOS cambia el
// formato, la tienda falla con un error claro en vez de mostrar precios equivocados.
const money = z.string().regex(/^-?\d+(\.\d+)?$/);
const price = z.object({ net: money, taxRate: money, gross: money });

const apiVariant = z.object({
  sku: z.string(),
  barcode: z.string().nullable(),
  name: z.string(),
  options: z.record(z.string(), z.string()),
  prices: z.object({
    currency: z.string().length(3),
    retail: price,
    wholesale: price.extend({ minQuantity: money.nullable() }).nullable(),
  }),
  availability: z.object({ total: money }).optional(),
});

const apiProduct = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  brand: z.string().nullable(),
  unit: z.string(),
  attributes: z.record(z.string(), z.string()),
  images: z.array(z.object({ id: z.uuid(), url: z.string(), alt: z.string(), primary: z.boolean(), position: z.number() })),
  variants: z.array(apiVariant),
  updatedAt: z.string(),
});

export const catalogPageSchema = z.object({
  data: z.array(apiProduct),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
});

export type ApiProduct = z.infer<typeof apiProduct>;

// Forma pública de la tienda. El stock se reduce a disponible/agotado: la cantidad exacta nunca sale del servidor.
// inStock = null cuando la clave API no tiene inventory:read (no se sabe).
export type StoreVariant = {
  sku: string;
  name: string;
  options: Record<string, string>;
  currency: string;
  price: string;
  wholesale: { price: string; minQuantity: string | null } | null;
  inStock: boolean | null;
};

export type StoreProduct = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  attributes: Record<string, string>;
  images: { id: string; alt: string }[];
  variants: StoreVariant[];
  fromPrice: string;
  currency: string;
  inStock: boolean | null;
};

export function toStoreProduct(p: ApiProduct): StoreProduct | null {
  if (p.variants.length === 0) return null;
  const variants: StoreVariant[] = p.variants.map((v) => ({
    sku: v.sku,
    name: v.name,
    options: v.options,
    currency: v.prices.currency,
    price: v.prices.retail.gross,
    wholesale: v.prices.wholesale ? { price: v.prices.wholesale.gross, minQuantity: v.prices.wholesale.minQuantity } : null,
    inStock: v.availability ? new Decimal(v.availability.total).gt(0) : null,
  }));
  const known = variants.filter((v) => v.inStock !== null);
  const cheapest = variants.reduce((min, v) => (new Decimal(v.price).lt(min.price) ? v : min));
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    brand: p.brand,
    unit: p.unit,
    attributes: p.attributes,
    images: [...p.images].sort((a, b) => Number(b.primary) - Number(a.primary) || a.position - b.position).map((i) => ({ id: i.id, alt: i.alt || p.name })),
    variants,
    fromPrice: cheapest.price,
    currency: cheapest.currency,
    inStock: known.length === 0 ? null : known.some((v) => v.inStock),
  };
}

/** Recorre todas las páginas del catálogo. `fetchPage` hace la petición HTTP (inyectable en pruebas). */
export async function fetchAllProducts(fetchPage: (page: number) => Promise<unknown>, maxPages = 100): Promise<StoreProduct[]> {
  const products: StoreProduct[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = catalogPageSchema.parse(await fetchPage(page));
    for (const p of body.data) {
      const sp = toStoreProduct(p);
      if (sp) products.push(sp);
    }
    if (!body.hasMore) break;
  }
  return products;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Búsqueda sin tildes ni mayúsculas por nombre, marca, categoría o SKU. Los agotados van al final. */
export function filterProducts(products: StoreProduct[], f: { q?: string; category?: string }) {
  const q = fold((f.q ?? "").trim());
  const cat = f.category ? fold(f.category) : null;
  return products
    .filter((p) => !cat || (p.category !== null && fold(p.category) === cat))
    .filter((p) => !q || [p.name, p.brand ?? "", p.category ?? "", ...p.variants.map((v) => v.sku)].some((t) => fold(t).includes(q)))
    .sort((a, b) => Number(a.inStock === false) - Number(b.inStock === false));
}

export function listCategories(products: StoreProduct[]) {
  return [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "es"));
}
