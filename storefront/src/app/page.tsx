import Link from "next/link";
import { Availability } from "@/components/add-to-cart";
import { AutoSubmitCheckbox, AutoSubmitSelect } from "@/components/auto-submit";
import { ProductImage } from "@/components/product-image";
import { getCatalog } from "@/lib/catalog";
import { filterProducts, isSort, listBrands, listCategories, SORTS } from "@/lib/catalog-map";
import { formatMoney } from "@/lib/format";
import { CatalogUnavailable } from "./catalog-unavailable";

type Params = { q?: string; categoria?: string; marca?: string; orden?: string; disponibles?: string; min?: string; max?: string };

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${active ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface hover:border-primary"}`;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { q = "", categoria, marca, min = "", max = "" } = params;
  const orden = isSort(params.orden) ? params.orden : "relevancia";
  const disponibles = params.disponibles === "1";
  let catalog;
  try {
    catalog = await getCatalog();
  } catch (err) {
    console.error("[tienda] no se pudo leer el catálogo", err);
    return <CatalogUnavailable />;
  }
  const categories = listCategories(catalog);
  const brands = listBrands(catalog);
  const knowsStock = catalog.some((p) => p.inStock !== null);
  const products = filterProducts(catalog, { q, category: categoria, brand: marca, sort: orden, onlyAvailable: disponibles, minPrice: min, maxPrice: max });

  // Enlaces que cambian un solo filtro y conservan los demás.
  const current: Params = { q, categoria, marca, orden: orden === "relevancia" ? undefined : orden, disponibles: disponibles ? "1" : undefined, min, max };
  const href = (change: Partial<Params>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...change })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };
  const filtered = !!(q || categoria || marca || disponibles || min || max);

  return (
    <div className="space-y-5">
      <form action="/" className="flex gap-2">
        {Object.entries({ ...current, q: undefined }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar productos, marcas o referencias"
          aria-label="Buscar"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-4 py-2.5"
        />
        <button className="rounded-lg bg-primary px-5 py-2.5 font-medium text-white hover:bg-primary-strong">Buscar</button>
      </form>

      {brands.length > 1 && (
        <nav aria-label="Marcas" className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted">Marca</span>
          <Link href={href({ marca: undefined })} className={chip(!marca)}>
            Todas
          </Link>
          {brands.map((b) => (
            <Link key={b} href={href({ marca: b })} className={chip(marca?.toLowerCase() === b.toLowerCase())}>
              {b}
            </Link>
          ))}
        </nav>
      )}

      {categories.length > 0 && (
        <nav aria-label="Categorías" className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted">Categoría</span>
          <Link href={href({ categoria: undefined })} className={chip(!categoria)}>
            Todo
          </Link>
          {categories.map((c) => (
            <Link key={c} href={href({ categoria: c })} className={chip(categoria?.toLowerCase() === c.toLowerCase())}>
              {c}
            </Link>
          ))}
        </nav>
      )}

      <form action="/" className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3">
        {Object.entries({ q: current.q, categoria, marca }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Ordenar por
          <AutoSubmitSelect name="orden" defaultValue={orden} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink">
            {Object.entries(SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
        <fieldset className="flex items-end gap-2">
          <legend className="sr-only">Rango de precio</legend>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Precio desde
            <input name="min" inputMode="numeric" defaultValue={min} placeholder="$ 0" className="num w-28 rounded-lg border border-border px-3 py-2 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            hasta
            <input name="max" inputMode="numeric" defaultValue={max} placeholder="Sin límite" className="num w-28 rounded-lg border border-border px-3 py-2 text-sm text-ink" />
          </label>
        </fieldset>
        {knowsStock && (
          <label className="flex items-center gap-2 py-2 text-sm">
            <AutoSubmitCheckbox name="disponibles" value="1" defaultChecked={disponibles} className="h-4 w-4 accent-[var(--color-primary)]" />
            Solo disponibles
          </label>
        )}
        <button className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:border-primary">Aplicar</button>
      </form>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>
          {products.length} {products.length === 1 ? "producto" : "productos"}
        </span>
        {filtered && (
          <Link href={orden === "relevancia" ? "/" : `/?orden=${orden}`} className="font-medium text-primary hover:underline">
            Limpiar filtros
          </Link>
        )}
      </div>

      {products.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-muted">
          {catalog.length === 0 ? "Pronto publicaremos nuestros productos." : "No encontramos productos con esos filtros."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p, i) => (
            <li key={p.id}>
              <Link href={`/p/${p.id}`} className="group block overflow-hidden rounded-xl border border-border bg-surface hover:border-primary">
                <div className={`relative aspect-square ${p.inStock === false ? "opacity-60" : ""}`}>
                  <ProductImage image={p.images[0]} sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" priority={i < 4} />
                </div>
                <div className="space-y-1 p-3">
                  {p.brand && <p className="text-xs uppercase tracking-wide text-muted">{p.brand}</p>}
                  <h2 className="line-clamp-2 text-sm font-medium group-hover:underline">{p.name}</h2>
                  <p className="num font-semibold">
                    {p.variants.length > 1 && <span className="text-xs font-normal text-muted">Desde </span>}
                    {formatMoney(p.fromPrice, p.currency)}
                  </p>
                  <Availability inStock={p.inStock} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
