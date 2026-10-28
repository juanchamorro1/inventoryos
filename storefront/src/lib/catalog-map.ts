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
  /** Precio al detal, con IVA. */
  price: string;
  /** Precio por mayor SIN IVA (costo + valor agregado, como lo define el negocio). Solo si es menor que el precio al detal. */
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
  updatedAt: string;
};

export function toStoreProduct(p: ApiProduct): StoreProduct | null {
  if (p.variants.length === 0) return null;
  const variants: StoreVariant[] = p.variants.map((v) => ({
    sku: v.sku,
    name: v.name,
    options: v.options,
    currency: v.prices.currency,
    price: v.prices.retail.gross,
    // El mayorista se publica sin IVA; si no queda por debajo del precio al detal, no se ofrece.
    wholesale:
      v.prices.wholesale && new Decimal(v.prices.wholesale.net).lt(v.prices.retail.gross)
        ? { price: v.prices.wholesale.net, minQuantity: v.prices.wholesale.minQuantity }
        : null,
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
    updatedAt: p.updatedAt,
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

export const SORTS = {
  relevancia: "Destacados",
  "precio-asc": "Precio: menor a mayor",
  "precio-desc": "Precio: mayor a menor",
  nombre: "Nombre: A–Z",
  recientes: "Más recientes",
} as const;
export type Sort = keyof typeof SORTS;

export const isSort = (s: string | undefined): s is Sort => !!s && Object.hasOwn(SORTS, s);

export type CatalogFilter = {
  q?: string;
  category?: string;
  brand?: string;
  sort?: Sort;
  onlyAvailable?: boolean;
  /** Rango sobre el precio «desde» (con IVA), en la moneda del catálogo. */
  minPrice?: string;
  maxPrice?: string;
};

/** Precio escrito por el visitante («50.000», «$ 50000») → Decimal; vacío o inválido = sin límite. */
export function parsePriceInput(s: string | undefined) {
  const digits = (s ?? "").replace(/\D/g, "");
  return digits ? new Decimal(digits) : null;
}

const byName = (a: StoreProduct, b: StoreProduct) => a.name.localeCompare(b.name, "es");

/**
 * Búsqueda sin tildes ni mayúsculas por nombre, marca, categoría o SKU, con filtros de categoría, marca,
 * disponibilidad y rango de precio. En «Destacados» los agotados van al final; los demás órdenes son estrictos.
 */
export function filterProducts(products: StoreProduct[], f: CatalogFilter) {
  const q = fold((f.q ?? "").trim());
  const cat = f.category ? fold(f.category) : null;
  const brand = f.brand ? fold(f.brand) : null;
  const min = parsePriceInput(f.minPrice);
  const max = parsePriceInput(f.maxPrice);
  const list = products
    .filter((p) => !cat || (p.category !== null && fold(p.category) === cat))
    .filter((p) => !brand || (p.brand !== null && fold(p.brand) === brand))
    .filter((p) => !f.onlyAvailable || p.inStock === true)
    .filter((p) => (!min || new Decimal(p.fromPrice).gte(min)) && (!max || new Decimal(p.fromPrice).lte(max)))
    .filter((p) => !q || [p.name, p.brand ?? "", p.category ?? "", ...p.variants.map((v) => v.sku)].some((t) => fold(t).includes(q)));
  switch (f.sort ?? "relevancia") {
    case "precio-asc":
      return list.sort((a, b) => new Decimal(a.fromPrice).cmp(b.fromPrice) || byName(a, b));
    case "precio-desc":
      return list.sort((a, b) => new Decimal(b.fromPrice).cmp(a.fromPrice) || byName(a, b));
    case "nombre":
      return list.sort(byName);
    case "recientes":
      return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byName(a, b));
    default:
      return list.sort((a, b) => Number(a.inStock === false) - Number(b.inStock === false));
  }
}

const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "es"));

export function listCategories(products: StoreProduct[]) {
  return distinct(products.map((p) => p.category));
}

export function listBrands(products: StoreProduct[]) {
  return distinct(products.map((p) => p.brand));
}
