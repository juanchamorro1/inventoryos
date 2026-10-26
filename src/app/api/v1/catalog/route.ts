import { listCatalogProducts } from "@/server/modules/integrations/public-catalog";
import { apiHandler } from "../_lib";

// Catálogo publicado (productos con sus variantes, fotos y precios minorista/mayorista). Contrato v1 de lectura.
export async function GET(req: Request) {
  const url = new URL(req.url);
  return apiHandler(req, (ctx) =>
    listCatalogProducts(ctx, {
      q: url.searchParams.get("q") ?? "",
      category: url.searchParams.get("category") ?? undefined,
      page: Number(url.searchParams.get("page")) || 1,
      limit: Number(url.searchParams.get("limit")) || 24,
    }),
  );
}
