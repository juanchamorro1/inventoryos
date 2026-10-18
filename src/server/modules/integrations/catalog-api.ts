import { sql } from "drizzle-orm";
import { withTenantTx } from "../../db/tx";
import type { TenantContext } from "../../platform/context";
import { dec, roundMoney } from "../../platform/decimal";
import { NotFoundError } from "../../platform/errors";
import { can, requirePermission } from "../../platform/permissions";

// Interfaz estable (v1) para integraciones externas como el asistente comercial de WhatsApp.
// Solo lectura: catálogo, precios y disponibilidad de la empresa dueña de la clave.

export type ApiVariant = {
  sku: string;
  barcode: string | null;
  product: string;
  variant: string;
  options: Record<string, string>;
  category: string | null;
  brand: string | null;
  price: { currency: string; net: string; taxRate: string; gross: string };
  availability?: { total: string; byWarehouse: { warehouse: string; code: string; quantity: string }[] };
};

type Row = {
  variant_id: string;
  sku: string;
  barcode: string | null;
  product: string;
  variant: string;
  options: Record<string, string>;
  category: string | null;
  brand: string | null;
  sale_price: string;
  tax_rate: string;
  currency: string;
};

async function load(ctx: TenantContext, where: ReturnType<typeof sql>, limit: number, offset: number) {
  const withStock = can(ctx, "inventory.read");
  return withTenantTx(ctx, async (tx) => {
    const rows = (
      await tx.execute<Row>(sql`
        select pv.id as variant_id, pv.sku, pv.barcode, p.name as product, pv.name as variant, pv.option_values as options,
               c.name as category, b.name as brand, pv.sale_price::text, coalesce(t.rate, 0)::text as tax_rate, o.currency
        from product_variants pv
        join products p on p.id = pv.product_id
        join organizations o on o.id = pv.organization_id
        left join categories c on c.id = p.category_id
        left join brands b on b.id = p.brand_id
        left join tax_rates t on t.id = p.tax_rate_id
        where pv.status = 'active' and p.status = 'active' and ${where}
        order by p.name, pv.sku
        limit ${limit} offset ${offset}`)
    ).rows;
    const stock = new Map<string, { warehouse: string; code: string; quantity: string }[]>();
    if (withStock && rows.length) {
      const ids = rows.map((r) => r.variant_id);
      const st = (
        await tx.execute<{ variant_id: string; warehouse: string; code: string; quantity: string }>(sql`
          select sv.variant_id, w.name as warehouse, w.code, sv.quantity::text as quantity
          from stock_valuations sv join warehouses w on w.id = sv.warehouse_id
          where w.status = 'active' and sv.quantity > 0 and sv.variant_id in ${ids}
          order by w.name`)
      ).rows;
      for (const s of st) {
        const list = stock.get(s.variant_id) ?? [];
        list.push({ warehouse: s.warehouse, code: s.code, quantity: s.quantity });
        stock.set(s.variant_id, list);
      }
    }
    return rows.map((r): ApiVariant => {
      const net = dec(r.sale_price);
      const gross = roundMoney(net.times(dec(r.tax_rate).div(100).plus(1)));
      const byWarehouse = stock.get(r.variant_id) ?? [];
      return {
        sku: r.sku,
        barcode: r.barcode,
        product: r.product,
        variant: r.variant,
        options: r.options,
        category: r.category,
        brand: r.brand,
        price: { currency: r.currency, net: net.toFixed(2), taxRate: dec(r.tax_rate).toString(), gross: gross.toFixed(2) },
        ...(withStock
          ? { availability: { total: byWarehouse.reduce((a, w) => a.plus(w.quantity), dec(0)).toString(), byWarehouse: byWarehouse.map((w) => ({ ...w, quantity: dec(w.quantity).toString() })) } }
          : {}),
      };
    });
  });
}

export async function searchCatalog(ctx: TenantContext, q: string, page: number, limit: number) {
  requirePermission(ctx, "catalog.read");
  const term = q.trim().slice(0, 100);
  const like = `%${term}%`;
  const where = term
    ? sql`(p.name ilike ${like} or pv.sku ilike ${like} or pv.name ilike ${like} or pv.barcode = ${term} or b.name ilike ${like} or c.name ilike ${like})`
    : sql`true`;
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 1);
  const data = await load(ctx, where, safeLimit + 1, (safePage - 1) * safeLimit);
  return { data: data.slice(0, safeLimit), page: safePage, limit: safeLimit, hasMore: data.length > safeLimit };
}

export async function getBySku(ctx: TenantContext, sku: string) {
  requirePermission(ctx, "catalog.read");
  const [item] = await load(ctx, sql`lower(pv.sku) = lower(${sku.slice(0, 64)})`, 1, 0);
  if (!item) throw new NotFoundError("SKU no encontrado.");
  return item;
}
