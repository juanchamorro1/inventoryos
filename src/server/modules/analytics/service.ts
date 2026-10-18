import { sql } from "drizzle-orm";
import { organizations } from "../../db/schema";
import { withTenantTx } from "../../db/tx";
import type { TenantContext } from "../../platform/context";
import { requirePermission } from "../../platform/permissions";

export type Period = 7 | 30 | 90 | 365;
export const PERIODS: Period[] = [7, 30, 90, 365];

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

/** Pasos iniciales completados (para la guía de primeros pasos del Inicio). */
export async function getSetupProgress(ctx: TenantContext) {
  requirePermission(ctx, "catalog.read");
  return withTenantTx(ctx, async (tx) => {
    const [r] = (
      await tx.execute<{ products: boolean; stock: boolean; sale: boolean; supplier: boolean; team: boolean }>(sql`
        select
          exists(select 1 from product_variants where status = 'active') as products,
          exists(select 1 from stock_movements where quantity > 0) as stock,
          exists(select 1 from sales) as sale,
          exists(select 1 from suppliers) as supplier,
          (select count(*) from memberships) > 1 as team`)
    ).rows;
    return r!;
  });
}

/** Indicadores calculados con datos reales del ledger, ventas y compras (zona horaria de la empresa). */
export async function getDashboard(ctx: TenantContext, days: Period = 30) {
  requirePermission(ctx, "reports.read");
  return withTenantTx(ctx, async (tx) => {
    const [org] = await tx.select({ tz: organizations.timezone, currency: organizations.currency }).from(organizations);
    const tz = org?.tz ?? "UTC";
    const since = sql`(date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${days - 1})) at time zone ${tz}`;

    const [stock] = (
      await tx.execute<{ value: string; units: string; skus: number; out_of_stock: number; low: number }>(sql`
        select
          coalesce((select sum(total_value) from stock_valuations), 0)::text as value,
          coalesce((select sum(quantity) from stock_valuations), 0)::text as units,
          (select count(*)::int from product_variants where status = 'active') as skus,
          (select count(*)::int from product_variants v where v.status = 'active'
             and coalesce((select sum(quantity) from stock_valuations sv where sv.variant_id = v.id), 0) = 0) as out_of_stock,
          (select count(*)::int from product_variants v where v.status = 'active' and v.low_stock_threshold > 0
             and coalesce((select sum(quantity) from stock_valuations sv where sv.variant_id = v.id), 0) <= v.low_stock_threshold) as low`)
    ).rows;

    const [salesSummary] = (
      await tx.execute<{ revenue: string; cost: string; count: number; returns: string }>(sql`
        select
          coalesce(sum(total), 0)::text as revenue,
          coalesce(sum(cost_total), 0)::text as cost,
          count(*)::int as count,
          coalesce((select sum(r.refund_total) from sale_returns r where r.created_at >= ${since}), 0)::text as returns
        from sales where status <> 'cancelled' and created_at >= ${since}`)
    ).rows;
    const [returnsCost] = (
      await tx.execute<{ cost: string }>(sql`
        select coalesce(sum(rl.quantity * rl.unit_cost), 0)::text as cost
        from sale_return_lines rl join sale_returns r on r.id = rl.sale_return_id where r.created_at >= ${since}`)
    ).rows;

    const [purchases] = (
      await tx.execute<{ value: string; receipts: number }>(sql`
        select coalesce(sum(m.total_cost), 0)::text as value, count(distinct d.id)::int as receipts
        from stock_movements m join stock_documents d on d.id = m.document_id
        where d.type in ('purchase_receipt', 'purchase_receipt_reversal') and m.created_at >= ${since}`)
    ).rows;

    const daily = (
      await tx.execute<{ day: string; sales: string; purchases: string }>(sql`
        with days as (
          select generate_series(date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${days - 1}), date_trunc('day', now() at time zone ${tz}), interval '1 day')::date as day
        ),
        s as (
          select (created_at at time zone ${tz})::date as day, sum(total) as total from sales
          where status <> 'cancelled' and created_at >= ${since} group by 1
        ),
        p as (
          select (m.created_at at time zone ${tz})::date as day, sum(m.total_cost) as total
          from stock_movements m join stock_documents d on d.id = m.document_id
          where d.type in ('purchase_receipt', 'purchase_receipt_reversal') and m.created_at >= ${since} group by 1
        )
        select to_char(days.day, 'YYYY-MM-DD') as day, coalesce(s.total, 0)::text as sales, coalesce(p.total, 0)::text as purchases
        from days left join s on s.day = days.day left join p on p.day = days.day order by days.day`)
    ).rows;

    const topProducts = (
      await tx.execute<{ variant_id: string; sku: string; name: string; units: string; revenue: string; margin: string }>(sql`
        select pv.id as variant_id, pv.sku, p.name || case when pv.name <> '' then ' · ' || pv.name else '' end as name,
          sum(sl.quantity - sl.quantity_returned)::text as units,
          sum(sl.line_total * (sl.quantity - sl.quantity_returned) / sl.quantity)::numeric(20,4)::text as revenue,
          sum((sl.line_subtotal - sl.line_cost) * (sl.quantity - sl.quantity_returned) / sl.quantity)::numeric(20,4)::text as margin
        from sale_lines sl
        join sales s on s.id = sl.sale_id
        join product_variants pv on pv.id = sl.variant_id
        join products p on p.id = pv.product_id
        where s.status <> 'cancelled' and s.created_at >= ${since}
        group by pv.id, pv.sku, p.name, pv.name
        having sum(sl.quantity - sl.quantity_returned) > 0
        order by sum(sl.quantity - sl.quantity_returned) desc, revenue desc
        limit 10`)
    ).rows;

    const movementsByType = (
      await tx.execute<{ type: string; documents: number }>(sql`
        select type, count(*)::int as documents from stock_documents where posted_at >= ${since} group by type order by documents desc`)
    ).rows;

    const byWarehouse = (
      await tx.execute<{ name: string; units: string; value: string }>(sql`
        select w.name, coalesce(sum(sv.quantity), 0)::text as units, coalesce(sum(sv.total_value), 0)::text as value
        from warehouses w left join stock_valuations sv on sv.warehouse_id = w.id
        where w.status = 'active' group by w.id, w.name order by value desc`)
    ).rows;

    return {
      days,
      currency: org?.currency ?? "COP",
      stock: stock!,
      sales: { ...salesSummary!, returnsCost: returnsCost?.cost ?? "0" },
      purchases: purchases!,
      daily,
      topProducts,
      movementsByType,
      byWarehouse,
    };
  });
}
