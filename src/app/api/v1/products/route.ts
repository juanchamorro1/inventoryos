import { searchCatalog } from "@/server/modules/integrations/catalog-api";
import { apiHandler } from "../_lib";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return apiHandler(req, (ctx) => searchCatalog(ctx, url.searchParams.get("q") ?? "", Number(url.searchParams.get("page")) || 1, Number(url.searchParams.get("limit")) || 20));
}
