import Link from "next/link";
import { Availability } from "@/components/add-to-cart";
import { ProductImage } from "@/components/product-image";
import { getCatalog } from "@/lib/catalog";
import { filterProducts, listCategories } from "@/lib/catalog-map";
import { formatMoney } from "@/lib/format";
import { CatalogUnavailable } from "./catalog-unavailable";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; categoria?: string }> }) {
  const { q = "", categoria } = await searchParams;
  let catalog;
  try {
    catalog = await getCatalog();
  } catch (err) {
    console.error("[tienda] no se pudo leer el catálogo", err);
    return <CatalogUnavailable />;
  }
  const categories = listCategories(catalog);
  const products = filterProducts(catalog, { q, category: categoria });
  const catHref = (c?: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (c) p.set("categoria", c);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <div className="space-y-6">
      <form action="/" className="flex gap-2">
        {categoria && <input type="hidden" name="categoria" value={categoria} />}
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

      {categories.length > 0 && (
        <nav aria-label="Categorías" className="flex flex-wrap gap-2">
          <Link href={catHref()} className={`rounded-full border px-3 py-1 text-sm ${!categoria ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface hover:border-primary"}`}>
            Todo
          </Link>
          {categories.map((c) => (
            <Link
              key={c}
              href={catHref(c)}
              className={`rounded-full border px-3 py-1 text-sm ${categoria?.toLowerCase() === c.toLowerCase() ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface hover:border-primary"}`}
            >
              {c}
            </Link>
          ))}
        </nav>
      )}

      {products.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-muted">
          {catalog.length === 0 ? "Pronto publicaremos nuestros productos." : "No encontramos productos con esa búsqueda."}
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
