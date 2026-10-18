import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  locations,
  products,
  productVariants,
  stockBalances,
  stockDocuments,
  stockMovements,
  stockValuations,
  users,
  warehouses,
  STOCK_DOCUMENT_TYPES,
} from "../../db/schema";
import { withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { NotFoundError, ValidationError } from "../../platform/errors";
import { claimIdempotency, completeIdempotency } from "../../platform/idempotency";
import { requirePermission } from "../../platform/permissions";
import { optionalText, parseOrThrow, zDecimal, zIdempotencyKey, zQty, zUnitCost, zUuid } from "../../platform/validation";
import { postStockDocument, reverseStockDocument, type PostLine } from "./posting";

const reason = z.string().trim().min(3, "Describe el motivo (mínimo 3 caracteres).").max(300);

const manualSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("receipt"),
    locationId: zUuid("Ubicación"),
    reason,
    notes: optionalText(),
    idempotencyKey: zIdempotencyKey,
    lines: z.array(z.object({ variantId: zUuid("Producto"), quantity: zQty(), unitCost: zUnitCost("El costo unitario") })).min(1, "Agrega al menos un producto."),
  }),
  z.object({
    type: z.literal("issue"),
    locationId: zUuid("Ubicación"),
    reason,
    notes: optionalText(),
    idempotencyKey: zIdempotencyKey,
    lines: z.array(z.object({ variantId: zUuid("Producto"), quantity: zQty() })).min(1, "Agrega al menos un producto."),
  }),
  z.object({
    type: z.literal("adjustment"),
    locationId: zUuid("Ubicación"),
    reason,
    notes: optionalText(),
    idempotencyKey: zIdempotencyKey,
    lines: z
      .array(
        z.object({
          variantId: zUuid("Producto"),
          counted: zDecimal({ scale: 4, min: 0, max: "99999999999999", label: "El conteo" }),
          unitCost: zUnitCost("El costo unitario").optional(),
        }),
      )
      .min(1, "Agrega al menos un producto."),
  }),
  z.object({
    type: z.literal("transfer"),
    fromLocationId: zUuid("Ubicación de origen"),
    toLocationId: zUuid("Ubicación de destino"),
    reason,
    notes: optionalText(),
    idempotencyKey: zIdempotencyKey,
    lines: z.array(z.object({ variantId: zUuid("Producto"), quantity: zQty() })).min(1, "Agrega al menos un producto."),
  }),
]);

export type ManualDocumentInput = z.input<typeof manualSchema>;

/** Entradas, salidas, ajustes por conteo y transferencias manuales. */
export async function postManualDocument(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "inventory.write");
  const input = parseOrThrow(manualSchema, raw);
  const variantCounts = new Map<string, number>();
  for (const l of input.lines) variantCounts.set(l.variantId, (variantCounts.get(l.variantId) ?? 0) + 1);
  if ([...variantCounts.values()].some((n) => n > 1)) throw new ValidationError("Un producto aparece repetido en las líneas.");

  return withTenantTx(ctx, async (tx) => {
    const existing = await claimIdempotency(tx, ctx.organizationId, input.idempotencyKey, `stock.${input.type}`);
    if (existing) return { documentId: existing, duplicate: true };

    let lines: PostLine[];
    switch (input.type) {
      case "receipt":
        lines = input.lines.map((l) => ({ variantId: l.variantId, locationId: input.locationId, quantity: l.quantity, cost: { kind: "unit", unitCost: l.unitCost } }));
        break;
      case "issue":
        lines = input.lines.map((l) => ({ variantId: l.variantId, locationId: input.locationId, quantity: l.quantity.neg(), cost: { kind: "average" } }));
        break;
      case "adjustment":
        lines = input.lines.map((l) => ({ variantId: l.variantId, locationId: input.locationId, counted: l.counted, unitCost: l.unitCost }));
        break;
      case "transfer": {
        if (input.fromLocationId === input.toLocationId) throw new ValidationError("El origen y el destino deben ser distintos.");
        lines = input.lines.flatMap((l, i): PostLine[] => [
          { variantId: l.variantId, locationId: input.fromLocationId, quantity: l.quantity.neg(), cost: { kind: "average" } },
          { variantId: l.variantId, locationId: input.toLocationId, quantity: l.quantity, cost: { kind: "sameAsLine", index: i * 2 } },
        ]);
        break;
      }
    }
    const result = await postStockDocument(tx, ctx, { type: input.type, reason: input.reason, notes: input.notes, lines });
    await completeIdempotency(tx, ctx.organizationId, input.idempotencyKey, result.documentId);
    await audit(tx, ctx, `stock.${input.type}`, { type: "stock_document", id: result.documentId }, { number: result.number, lines: result.movements.length });
    return { documentId: result.documentId, number: result.number, duplicate: false };
  });
}

export async function reverseDocument(ctx: TenantContext, documentId: string, rawReason: unknown) {
  requirePermission(ctx, "inventory.write");
  const r = parseOrThrow(z.object({ reason }), { reason: rawReason });
  zUuid().parse(documentId);
  return withTenantTx(ctx, async (tx) => {
    const result = await reverseStockDocument(tx, ctx, documentId, { type: "reversal", reason: r.reason });
    await audit(tx, ctx, "stock.reversed", { type: "stock_document", id: documentId }, { reversal: result.number, reason: r.reason });
    return result;
  });
}

// ---------- Consultas ----------

export const DOC_TYPE_LABELS: Record<(typeof STOCK_DOCUMENT_TYPES)[number], string> = {
  opening: "Inventario inicial",
  receipt: "Ingreso de mercancía",
  issue: "Salida de mercancía",
  adjustment: "Corrección por conteo",
  transfer: "Traslado",
  purchase_receipt: "Llegada de pedido",
  purchase_receipt_reversal: "Llegada de pedido anulada",
  sale: "Venta",
  sale_return: "Devolución de cliente",
  sale_cancellation: "Venta anulada",
  reversal: "Movimiento deshecho",
};

export type StockFilters = { search?: string; warehouseId?: string; status?: "all" | "low" | "out"; page?: number; pageSize?: number };

/** Existencias por variante (total y por bodega) con su valoración. */
export async function listStock(ctx: TenantContext, f: StockFilters = {}) {
  requirePermission(ctx, "inventory.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, f.pageSize ?? 25);
  return withTenantTx(ctx, async (tx) => {
    const conds: SQL[] = [eq(productVariants.status, "active")];
    if (f.search) {
      const q = `%${f.search.trim()}%`;
      conds.push(or(ilike(productVariants.sku, q), ilike(products.name, q), ilike(productVariants.name, q), ilike(productVariants.barcode, q))!);
    }
    const whFilter = f.warehouseId ? sql`and sv.warehouse_id = ${f.warehouseId}` : sql``;
    const qtyExpr = sql<string>`coalesce((select sum(sv.quantity) from stock_valuations sv where sv.variant_id = ${productVariants.id} ${whFilter}), 0)`;
    const valueExpr = sql<string>`coalesce((select sum(sv.total_value) from stock_valuations sv where sv.variant_id = ${productVariants.id} ${whFilter}), 0)`;
    if (f.status === "low") conds.push(sql`${productVariants.lowStockThreshold} > 0 and ${qtyExpr} <= ${productVariants.lowStockThreshold}`);
    if (f.status === "out") conds.push(sql`${qtyExpr} = 0`);
    const where = and(...conds);
    const rows = await tx
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        variantName: productVariants.name,
        sku: productVariants.sku,
        unit: products.unit,
        lowStockThreshold: productVariants.lowStockThreshold,
        salePrice: productVariants.salePrice,
        quantity: qtyExpr,
        value: valueExpr,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where)
      .orderBy(asc(products.name), asc(productVariants.sku))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx
      .select({ n: count() })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where);
    return { rows, total: total?.n ?? 0, page, pageSize };
  });
}

/** Detalle de existencias de una variante por bodega y ubicación. */
export async function stockByVariant(ctx: TenantContext, variantId: string) {
  requirePermission(ctx, "inventory.read");
  return withTenantTx(ctx, async (tx) => {
    const byLocation = await tx
      .select({
        warehouseId: warehouses.id,
        warehouseName: warehouses.name,
        locationId: locations.id,
        locationCode: locations.code,
        locationName: locations.name,
        onHand: stockBalances.onHand,
      })
      .from(stockBalances)
      .innerJoin(locations, eq(locations.id, stockBalances.locationId))
      .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
      .where(and(eq(stockBalances.variantId, variantId), sql`${stockBalances.onHand} <> 0`))
      .orderBy(asc(warehouses.name), asc(locations.code));
    const byWarehouse = await tx
      .select({
        warehouseId: warehouses.id,
        warehouseName: warehouses.name,
        quantity: stockValuations.quantity,
        totalValue: stockValuations.totalValue,
        avgCost: stockValuations.avgCost,
      })
      .from(stockValuations)
      .innerJoin(warehouses, eq(warehouses.id, stockValuations.warehouseId))
      .where(eq(stockValuations.variantId, variantId))
      .orderBy(asc(warehouses.name));
    return { byLocation, byWarehouse };
  });
}

export type MovementFilters = {
  variantId?: string;
  warehouseId?: string;
  type?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function listMovements(ctx: TenantContext, f: MovementFilters = {}) {
  requirePermission(ctx, "inventory.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, f.pageSize ?? 50);
  return withTenantTx(ctx, async (tx) => {
    const conds: SQL[] = [];
    if (f.variantId) conds.push(eq(stockMovements.variantId, f.variantId));
    if (f.warehouseId) conds.push(eq(stockMovements.warehouseId, f.warehouseId));
    if (f.type && (STOCK_DOCUMENT_TYPES as readonly string[]).includes(f.type)) conds.push(eq(stockDocuments.type, f.type as (typeof STOCK_DOCUMENT_TYPES)[number]));
    if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(stockMovements.createdAt, new Date(`${f.from}T00:00:00`)));
    if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(stockMovements.createdAt, new Date(`${f.to}T23:59:59.999`)));
    if (f.search) {
      const q = `%${f.search.trim()}%`;
      conds.push(or(ilike(productVariants.sku, q), ilike(products.name, q), ilike(stockDocuments.number, q))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const base = tx
      .select({
        id: stockMovements.id,
        createdAt: stockMovements.createdAt,
        documentId: stockDocuments.id,
        documentNumber: stockDocuments.number,
        type: stockDocuments.type,
        reason: stockDocuments.reason,
        sku: productVariants.sku,
        productName: products.name,
        variantName: productVariants.name,
        variantId: productVariants.id,
        warehouseName: warehouses.name,
        locationCode: locations.code,
        quantity: stockMovements.quantity,
        unitCost: stockMovements.unitCost,
        totalCost: stockMovements.totalCost,
        locationQtyAfter: stockMovements.locationQtyAfter,
        avgCostAfter: stockMovements.avgCostAfter,
        userName: users.name,
      })
      .from(stockMovements)
      .innerJoin(stockDocuments, eq(stockDocuments.id, stockMovements.documentId))
      .innerJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
      .innerJoin(locations, eq(locations.id, stockMovements.locationId))
      .innerJoin(users, eq(users.id, stockMovements.createdBy));
    const rows = await base
      .where(where)
      .orderBy(desc(stockMovements.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx
      .select({ n: count() })
      .from(stockMovements)
      .innerJoin(stockDocuments, eq(stockDocuments.id, stockMovements.documentId))
      .innerJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where);
    return { rows, total: total?.n ?? 0, page, pageSize };
  });
}

export async function getDocument(ctx: TenantContext, documentId: string) {
  requirePermission(ctx, "inventory.read");
  if (!z.string().uuid().safeParse(documentId).success) throw new NotFoundError();
  return withTenantTx(ctx, async (tx) => {
    const [doc] = await tx
      .select({ doc: stockDocuments, userName: users.name })
      .from(stockDocuments)
      .innerJoin(users, eq(users.id, stockDocuments.createdBy))
      .where(eq(stockDocuments.id, documentId));
    if (!doc) throw new NotFoundError("Documento no encontrado.");
    const lines = await tx
      .select({
        lineNo: stockMovements.lineNo,
        sku: productVariants.sku,
        productName: products.name,
        variantName: productVariants.name,
        warehouseName: warehouses.name,
        locationCode: locations.code,
        quantity: stockMovements.quantity,
        unitCost: stockMovements.unitCost,
        totalCost: stockMovements.totalCost,
        locationQtyAfter: stockMovements.locationQtyAfter,
      })
      .from(stockMovements)
      .innerJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
      .innerJoin(locations, eq(locations.id, stockMovements.locationId))
      .where(eq(stockMovements.documentId, documentId))
      .orderBy(asc(stockMovements.lineNo));
    const [reversal] = await tx
      .select({ id: stockDocuments.id, number: stockDocuments.number })
      .from(stockDocuments)
      .where(eq(stockDocuments.reversesDocumentId, documentId));
    const [reverses] = doc.doc.reversesDocumentId
      ? await tx.select({ id: stockDocuments.id, number: stockDocuments.number }).from(stockDocuments).where(eq(stockDocuments.id, doc.doc.reversesDocumentId))
      : [];
    return { ...doc.doc, userName: doc.userName, lines, reversedBy: reversal ?? null, reverses: reverses ?? null };
  });
}

/** Variantes con existencias en o por debajo del mínimo configurado. */
export async function lowStock(ctx: TenantContext, limit = 50) {
  requirePermission(ctx, "inventory.read");
  return withTenantTx(ctx, async (tx) => {
    const qtyExpr = sql<string>`coalesce((select sum(sv.quantity) from stock_valuations sv where sv.variant_id = ${productVariants.id}), 0)`;
    return tx
      .select({
        variantId: productVariants.id,
        productId: products.id,
        sku: productVariants.sku,
        productName: products.name,
        variantName: productVariants.name,
        threshold: productVariants.lowStockThreshold,
        quantity: qtyExpr,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.status, "active"), sql`${productVariants.lowStockThreshold} > 0`, sql`${qtyExpr} <= ${productVariants.lowStockThreshold}`))
      .orderBy(sql`${qtyExpr} asc`, asc(productVariants.sku))
      .limit(limit);
  });
}

export type ReconciliationIssue = { kind: string; sku: string; where: string; expected: string; actual: string };

/**
 * Verifica que los saldos y la valoración coinciden con la suma de los movimientos del ledger
 * y que la valoración por bodega coincide con los saldos por ubicación.
 */
export async function reconcile(ctx: TenantContext): Promise<{ checked: number; issues: ReconciliationIssue[] }> {
  requirePermission(ctx, "inventory.read");
  return withTenantTx(ctx, async (tx) => {
    const balanceIssues = await tx.execute<{ sku: string; loc: string; expected: string; actual: string }>(sql`
      select pv.sku, w.name || ' / ' || l.code as loc, coalesce(m.qty, 0)::text as expected, b.on_hand::text as actual
      from stock_balances b
      join product_variants pv on pv.id = b.variant_id
      join locations l on l.id = b.location_id
      join warehouses w on w.id = b.warehouse_id
      left join (select variant_id, location_id, sum(quantity) qty from stock_movements group by 1, 2) m
        on m.variant_id = b.variant_id and m.location_id = b.location_id
      where b.on_hand <> coalesce(m.qty, 0)`);
    const valuationIssues = await tx.execute<{ sku: string; wh: string; field: string; expected: string; actual: string }>(sql`
      with mv as (select variant_id, warehouse_id, sum(quantity) qty, sum(total_cost) val from stock_movements group by 1, 2),
           bal as (select variant_id, warehouse_id, sum(on_hand) qty from stock_balances group by 1, 2)
      select pv.sku, w.name as wh, x.field, x.expected, x.actual
      from stock_valuations v
      join product_variants pv on pv.id = v.variant_id
      join warehouses w on w.id = v.warehouse_id
      left join mv on mv.variant_id = v.variant_id and mv.warehouse_id = v.warehouse_id
      left join bal on bal.variant_id = v.variant_id and bal.warehouse_id = v.warehouse_id
      cross join lateral (values
        ('cantidad (ledger)', coalesce(mv.qty, 0)::text, v.quantity::text, v.quantity <> coalesce(mv.qty, 0)),
        ('valor (ledger)', coalesce(mv.val, 0)::text, v.total_value::text, v.total_value <> coalesce(mv.val, 0)),
        ('cantidad (ubicaciones)', coalesce(bal.qty, 0)::text, v.quantity::text, v.quantity <> coalesce(bal.qty, 0))
      ) as x(field, expected, actual, bad)
      where x.bad`);
    const [checked] = await tx.select({ n: count() }).from(stockBalances);
    return {
      checked: checked?.n ?? 0,
      issues: [
        ...balanceIssues.rows.map((r) => ({ kind: "saldo por ubicación", sku: r.sku, where: r.loc, expected: r.expected, actual: r.actual })),
        ...valuationIssues.rows.map((r) => ({ kind: r.field, sku: r.sku, where: r.wh, expected: r.expected, actual: r.actual })),
      ],
    };
  });
}
