import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/add-to-cart";
import { ProductImage } from "@/components/product-image";
import { getProduct } from "@/lib/catalog";
import { CatalogUnavailable } from "../../catalog-unavailable";

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  try {
    return { product: await getProduct(id) };
  } catch (err) {
    console.error("[tienda] no se pudo leer el catálogo", err);
    return { error: true as const };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await load((await params).id);
  return r.product ? { title: r.product.name, description: r.product.description ?? undefined } : {};
}

export default async function ProductPage({ params }: Props) {
  const r = await load((await params).id);
  if ("error" in r) return <CatalogUnavailable />;
  const p = r.product;
  if (!p) notFound();
  const attributes = Object.entries(p.attributes);

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted">
        <Link href="/" className="hover:underline">Catálogo</Link>
        {p.category && (
          <>
            {" / "}
            <Link href={`/?categoria=${encodeURIComponent(p.category)}`} className="hover:underline">{p.category}</Link>
          </>
        )}
      </nav>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-surface">
            <ProductImage image={p.images[0]} sizes="(min-width: 768px) 50vw, 100vw" priority />
          </div>
          {p.images.length > 1 && (
            <ul className="grid grid-cols-4 gap-2">
              {p.images.slice(1, 9).map((img) => (
                <li key={img.id} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-surface">
                  <ProductImage image={img} sizes="12vw" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-5">
          <div>
            {p.brand && (
              <Link href={`/?marca=${encodeURIComponent(p.brand)}`} className="text-sm uppercase tracking-wide text-muted hover:text-primary hover:underline">
                {p.brand}
              </Link>
            )}
            <h1 className="text-2xl font-semibold">{p.name}</h1>
          </div>
          <AddToCart productName={p.name} variants={p.variants} />
          {p.description && <p className="whitespace-pre-line text-muted">{p.description}</p>}
          {attributes.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {attributes.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
