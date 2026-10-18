"use server";

import { z } from "zod";
import { withContext } from "@/server/actions/run";
import { searchVariants, type VariantOption } from "@/server/modules/catalog/service";

/** Búsqueda de variantes para los selectores de líneas (ventas, compras y movimientos). */
export async function searchVariantsAction(q: string, locationId?: string): Promise<VariantOption[]> {
  const term = z.string().max(100).catch("").parse(q);
  const loc = z.string().uuid().optional().catch(undefined).parse(locationId || undefined);
  const r = await withContext((ctx) => searchVariants(ctx, term, { locationId: loc, limit: 15 }));
  return r.ok ? r.value : [];
}
