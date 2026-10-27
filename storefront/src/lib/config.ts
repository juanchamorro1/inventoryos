import "server-only";

export function storeConfig() {
  const revalidate = Number(process.env.CATALOG_REVALIDATE_SECONDS);
  return {
    apiUrl: (process.env.INVENTORYOS_API_URL ?? "").replace(/\/+$/, ""),
    apiKey: process.env.INVENTORYOS_API_KEY ?? "",
    storeName: process.env.STORE_NAME?.trim() || "Tienda",
    whatsapp: (process.env.STORE_WHATSAPP ?? "").replace(/\D/g, ""),
    revalidateSeconds: Number.isInteger(revalidate) && revalidate > 0 ? revalidate : 60,
  };
}
