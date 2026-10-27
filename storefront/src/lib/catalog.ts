import "server-only";
import { cache } from "react";
import { fetchAllProducts, type StoreProduct } from "./catalog-map";
import { storeConfig } from "./config";

export class CatalogUnavailableError extends Error {}

/**
 * Catálogo completo leído de InventoryOS con la clave API (solo en el servidor). Next guarda la respuesta
 * y la vuelve a pedir cada CATALOG_REVALIDATE_SECONDS: así la web sigue los cambios de productos,
 * precios y stock sin tocar la base de datos.
 */
export const getCatalog = cache(async (): Promise<StoreProduct[]> => {
  const cfg = storeConfig();
  if (!cfg.apiUrl || !cfg.apiKey) throw new CatalogUnavailableError("Faltan INVENTORYOS_API_URL o INVENTORYOS_API_KEY.");
  return fetchAllProducts(async (page) => {
    const res = await fetch(`${cfg.apiUrl}/api/v1/catalog?page=${page}&limit=100`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" },
      next: { revalidate: cfg.revalidateSeconds, tags: ["catalog"] },
    });
    if (!res.ok) throw new CatalogUnavailableError(`InventoryOS respondió ${res.status} al leer el catálogo.`);
    return res.json();
  });
});

export async function getProduct(id: string) {
  return (await getCatalog()).find((p) => p.id === id) ?? null;
}

/** Solo se sirven fotos de productos publicados (no cualquier foto de la empresa). */
export async function isPublishedImage(id: string) {
  return (await getCatalog()).some((p) => p.images.some((i) => i.id === id));
}
