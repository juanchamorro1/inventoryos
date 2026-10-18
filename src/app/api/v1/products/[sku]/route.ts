import { getBySku } from "@/server/modules/integrations/catalog-api";
import { apiHandler } from "../../_lib";

export async function GET(req: Request, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  return apiHandler(req, async (ctx) => ({ data: await getBySku(ctx, decodeURIComponent(sku)) }));
}
