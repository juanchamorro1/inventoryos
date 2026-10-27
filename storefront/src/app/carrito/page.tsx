import type { Metadata } from "next";
import { CartView } from "@/components/cart-view";
import { getCatalog } from "@/lib/catalog";
import type { CartVariantInfo } from "@/lib/cart";
import { storeConfig } from "@/lib/config";
import { variantLabel } from "@/lib/format";
import { CatalogUnavailable } from "../catalog-unavailable";

export const metadata: Metadata = { title: "Carrito" };
// Se arma en cada visita (con el catálogo en caché de getCatalog): nunca queda congelado con lo que había al compilar.
export const dynamic = "force-dynamic";

export default async function CartPage() {
  let catalog;
  try {
    catalog = await getCatalog();
  } catch (err) {
    console.error("[tienda] no se pudo leer el catálogo", err);
    return <CatalogUnavailable />;
  }
  // Precio y disponibilidad vigentes de cada variante publicada (sin cantidades de stock).
  const variants: CartVariantInfo[] = catalog.flatMap((p) =>
    p.variants.map((v) => ({ sku: v.sku, productId: p.id, label: variantLabel(p.name, v), currency: v.currency, price: v.price, inStock: v.inStock })),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Tu carrito</h1>
      <CartView variants={variants} whatsapp={storeConfig().whatsapp} />
    </div>
  );
}
