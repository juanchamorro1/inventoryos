import "server-only";
import { sql } from "drizzle-orm";
import { withTenantTx } from "../../db/tx";
import type { TenantContext } from "../../platform/context";
import { dec, roundMoney } from "../../platform/decimal";
import { can, requirePermission } from "../../platform/permissions";
import { ensurePricesCurrent, settingsTx } from "../pricing/service";

// Contrato de LECTURA del catálogo para integraciones (p. ej. la futura web pública). Versión 1.
//   - Solo productos y variantes activos con precio minorista publicado (> 0). Nunca costos, márgenes,
//     proveedores ni datos internos.
//   - Identificadores estables: el id (UUID) del producto y el SKU de cada variante.
//   - Las fotos se sirven por /api/v1/images/<id> con la misma clave API (no hay URLs públicas del almacenamiento).
//   - La web nunca accede a la base de datos: consume este contrato con una clave de solo lectura.

export type CatalogPrice = { net: string; taxRate: string; gross: string };

export type CatalogVariantV1 = {
  sku: string;
  barcode: string | null;
  name: string;
  options: Record<string, string>;
  prices: {
    currency: string;
    retail: CatalogPrice;
    wholesale: (CatalogPrice & { minQuantity: string | null }) | null;
  };
  availability?: { total: string };
};

export type CatalogProductV1 = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  attributes: Record<string, string>;
  images: { id: string; url: string; alt: string; primary: boolean; position: number }[];
  variants: CatalogVariantV1[];
  updatedAt: string;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  attributes: Record<string, string>;
  updated_at: Date;
  tax_rate: string;
  currency: string;
};

const price = (net: string, taxRate: string): CatalogPrice => {
  const n = dec(net);
  return { net: n.toFixed(2), taxRate: dec(taxRate).toString(), gross: roundMoney(n.times(dec(taxRate).div(100).plus(1))).toFixed(2) };
};

export async function listCatalogProducts(ctx: TenantContext, f: { q?: string; category?: string; page?: number; limit?: number } = {}) {
  requirePermission(ctx, "catalog.read");
  // Una TRM nueva se refleja antes de responder (según la política de la empresa).
  await ensurePricesCurrent(ctx);
  const limit = Math.min(Math.max(f.limit ?? 24, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const term = (f.q ?? "").trim().slice(0, 100);
  const like = `%${term}%`;
  const withStock = can(ctx, "inventory.read");
  return withTenantTx(ctx, async (tx) => {
    const { wholesaleEnabled } = await settingsTx(tx, ctx.organizationId);
    const visible = sql`p.status = 'active' and exists (select 1 from product_variants v where v.product_id = p.id and v.status = 'active' and v.sale_price > 0)`;
    const search = term ? sql`and (p.name ilike ${like} or exists (select 1 from product_variants v where v.product_id = p.id and (v.sku ilike ${like} or v.reference_code ilike ${like})))` : sql``;
    const category = f.category ? sql`and lower(c.name) = lower(${f.category.slice(0, 80)})` : sql``;
    const rows = (
      await tx.execute<ProductRow>(sql`
        select p.id, p.name, p.description, c.name as category, b.name as brand, p.unit, p.attributes, p.updated_at,
               coalesce(t.rate, 0)::text as tax_rate, o.currency
        from products p
        join organizations o on o.id = p.organization_id
        left join categories c on c.id = p.category_id
        left join brands b on b.id = p.brand_id
        left join tax_rates t on t.id = p.tax_rate_id
        where ${visible} ${search} ${category}
        order by p.name, p.id
        limit ${limit + 1} offset ${(page - 1) * limit}`)
    ).rows;
    const ids = rows.slice(0, limit).map((r) => r.id);
    const variants = ids.length
      ? (
          await tx.execute<{ product_id: string; sku: string; barcode: string | null; name: string; options: Record<string, string>; sale_price: string; wholesale_price: string | null; wholesale_min_qty: string | null; stock: string }>(sql`
            select v.product_id, v.sku, v.barcode, v.name, v.option_values as options, v.sale_price::text, v.wholesale_price::text, v.wholesale_min_qty::text,
                   coalesce((select sum(sv.quantity) from stock_valuations sv where sv.variant_id = v.id), 0)::text as stock
            from product_variants v
            where v.product_id in ${ids} and v.status = 'active' and v.sale_price > 0
            order by v.sku`)
        ).rows
      : [];
    const images = ids.length
      ? (
          await tx.execute<{ id: string; product_id: string; alt_text: string; is_primary: boolean; position: number }>(sql`
            select id, product_id, alt_text, is_primary, position from product_images where product_id in ${ids} order by position, created_at`)
        ).rows
      : [];
    const data: CatalogProductV1[] = rows.slice(0, limit).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      brand: p.brand,
      unit: p.unit,
      attributes: p.attributes,
      images: images.filter((i) => i.product_id === p.id).map((i) => ({ id: i.id, url: `/api/v1/images/${i.id}`, alt: i.alt_text, primary: i.is_primary, position: i.position })),
      variants: variants
        .filter((v) => v.product_id === p.id)
        .map((v) => ({
          sku: v.sku,
          barcode: v.barcode,
          name: v.name,
          options: v.options,
          prices: {
            currency: p.currency,
            retail: price(v.sale_price, p.tax_rate),
            wholesale: wholesaleEnabled && v.wholesale_price !== null ? { ...price(v.wholesale_price, p.tax_rate), minQuantity: v.wholesale_min_qty ? dec(v.wholesale_min_qty).toString() : null } : null,
          },
          ...(withStock ? { availability: { total: dec(v.stock).toString() } } : {}),
        })),
      updatedAt: new Date(p.updated_at).toISOString(),
    }));
    return { data, page, limit, hasMore: rows.length > limit };
  });
}
