import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  goodsReceiptLines,
  goodsReceipts,
  locations,
  productVariants,
  products,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  users,
  warehouses,
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderStatus,
} from "../../db/schema";
import type { Tx } from "../../db/client";
import { withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { costStr, dec, qtyStr, rateStr } from "../../platform/decimal";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError } from "../../platform/errors";
import { claimIdempotency, completeIdempotency } from "../../platform/idempotency";
import { requirePermission } from "../../platform/permissions";
import { nextNumber } from "../../platform/sequences";
import { optionalText, parseOrThrow, zDecimal, zIdempotencyKey, zQty, zUnitCost, zUuid } from "../../platform/validation";
import { postStockDocument, reverseStockDocument } from "../inventory/posting";

// ---------- Proveedores ----------

const supplierSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre del proveedor.").max(160),
  taxId: optionalText(40),
  contactName: optionalText(120),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || z.string().email().safeParse(v).success, "Correo inválido."),
  phone: optionalText(40),
  address: optionalText(300),
  notes: optionalText(2000),
});

export async function listSuppliers(ctx: TenantContext, f: { search?: string; status?: "active" | "archived"; page?: number; pageSize?: number } = {}) {
  requirePermission(ctx, "purchasing.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, f.pageSize ?? 25);
  return withTenantTx(ctx, async (tx) => {
    const conds: SQL[] = [eq(suppliers.status, f.status ?? "active")];
    if (f.search) {
      const q = `%${f.search.trim()}%`;
      conds.push(or(ilike(suppliers.name, q), ilike(suppliers.taxId, q), ilike(suppliers.email, q))!);
    }
    const where = and(...conds);
    const rows = await tx
      .select({
        supplier: suppliers,
        openOrders: sql<number>`(select count(*)::int from purchase_orders po where po.supplier_id = ${suppliers.id} and po.status in ('ordered','partially_received'))`,
      })
      .from(suppliers)
      .where(where)
      .orderBy(asc(suppliers.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx.select({ n: count() }).from(suppliers).where(where);
    return { rows: rows.map((r) => ({ ...r.supplier, openOrders: r.openOrders })), total: total?.n ?? 0, page, pageSize };
  });
}

export async function getSupplier(ctx: TenantContext, id: string) {
  requirePermission(ctx, "purchasing.read");
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Proveedor no encontrado.");
  const [s] = await withTenantTx(ctx, (tx) => tx.select().from(suppliers).where(eq(suppliers.id, id)));
  if (!s) throw new NotFoundError("Proveedor no encontrado.");
  return s;
}

function translateSupplier(err: unknown): never {
  if (isUniqueViolation(err, "suppliers_org_tax_uq")) throw new ValidationError("Ya existe un proveedor con ese NIT / identificación.", { taxId: ["Repetido."] });
  throw err;
}

export async function createSupplier(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "purchasing.write");
  const input = parseOrThrow(supplierSchema, raw);
  try {
    return await withTenantTx(ctx, async (tx) => {
      const [s] = await tx.insert(suppliers).values({ organizationId: ctx.organizationId, ...input }).returning({ id: suppliers.id });
      await audit(tx, ctx, "supplier.created", { type: "supplier", id: s!.id }, { name: input.name });
      return s!.id;
    });
  } catch (err) {
    translateSupplier(err);
  }
}

export async function updateSupplier(ctx: TenantContext, id: string, raw: unknown) {
  requirePermission(ctx, "purchasing.write");
  const input = parseOrThrow(supplierSchema, raw);
  try {
    await withTenantTx(ctx, async (tx) => {
      const updated = await tx.update(suppliers).set(input).where(eq(suppliers.id, id)).returning({ id: suppliers.id });
      if (updated.length === 0) throw new NotFoundError("Proveedor no encontrado.");
      await audit(tx, ctx, "supplier.updated", { type: "supplier", id }, { name: input.name });
    });
  } catch (err) {
    translateSupplier(err);
  }
}

export async function setSupplierStatus(ctx: TenantContext, id: string, status: "active" | "archived") {
  requirePermission(ctx, "purchasing.write");
  await withTenantTx(ctx, async (tx) => {
    const updated = await tx.update(suppliers).set({ status }).where(eq(suppliers.id, id)).returning({ id: suppliers.id });
    if (updated.length === 0) throw new NotFoundError("Proveedor no encontrado.");
    await audit(tx, ctx, `supplier.${status === "archived" ? "archived" : "restored"}`, { type: "supplier", id });
  });
}

// ---------- Órdenes de compra ----------

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Borrador",
  ordered: "Pedido al proveedor",
  partially_received: "Llegó una parte",
  received: "Recibido completo",
  closed: "Cerrado",
  cancelled: "Cancelado",
};

const poSchema = z.object({
  supplierId: zUuid("Proveedor"),
  warehouseId: zUuid("Bodega"),
  expectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  notes: optionalText(2000),
  lines: z
    .array(
      z.object({
        variantId: zUuid("Producto"),
        quantity: zQty(),
        unitCost: zUnitCost("El costo unitario"),
        taxRate: zDecimal({ scale: 4, min: 0, max: "100", label: "El impuesto" }).optional(),
      }),
    )
    .min(1, "Agrega al menos un producto.")
    .max(300),
});

async function assertDraftEditable(tx: Tx, id: string) {
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
  if (!po) throw new NotFoundError("Orden de compra no encontrada.");
  if (po.status !== "draft") throw new ConflictError("Solo se pueden editar órdenes en borrador.");
  return po;
}

async function writeLines(tx: Tx, ctx: TenantContext, purchaseOrderId: string, lines: z.output<typeof poSchema>["lines"]) {
  const ids = lines.map((l) => l.variantId);
  if (new Set(ids).size !== ids.length) throw new ValidationError("Un producto aparece repetido en la orden.");
  const found = await tx.select({ id: productVariants.id }).from(productVariants).where(and(inArray(productVariants.id, ids), eq(productVariants.status, "active")));
  if (found.length !== ids.length) throw new ValidationError("Algún producto no existe o está archivado.");
  await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));
  await tx.insert(purchaseOrderLines).values(
    lines.map((l, i) => ({
      organizationId: ctx.organizationId,
      purchaseOrderId,
      lineNo: i + 1,
      variantId: l.variantId,
      quantityOrdered: qtyStr(l.quantity),
      unitCost: costStr(l.unitCost),
      taxRate: rateStr(l.taxRate),
    })),
  );
}

async function assertSupplierAndWarehouse(tx: Tx, supplierId: string, warehouseId: string) {
  const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.status, "active")));
  if (!s) throw new ValidationError("Proveedor no encontrado o archivado.", { supplierId: ["Selecciona un proveedor activo."] });
  const [w] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.id, warehouseId), eq(warehouses.status, "active")));
  if (!w) throw new ValidationError("Bodega no encontrada o archivada.", { warehouseId: ["Selecciona una bodega activa."] });
}

export async function createPurchaseOrder(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "purchasing.write");
  const input = parseOrThrow(poSchema, raw);
  return withTenantTx(ctx, async (tx) => {
    await assertSupplierAndWarehouse(tx, input.supplierId, input.warehouseId);
    const number = await nextNumber(tx, ctx.organizationId, "purchase_order");
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        organizationId: ctx.organizationId,
        number,
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        expectedDate: input.expectedDate ?? null,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: purchaseOrders.id });
    await writeLines(tx, ctx, po!.id, input.lines);
    await audit(tx, ctx, "purchase_order.created", { type: "purchase_order", id: po!.id }, { number, lines: input.lines.length });
    return po!.id;
  });
}

export async function updatePurchaseOrder(ctx: TenantContext, id: string, raw: unknown) {
  requirePermission(ctx, "purchasing.write");
  const input = parseOrThrow(poSchema, raw);
  await withTenantTx(ctx, async (tx) => {
    await assertDraftEditable(tx, id);
    await assertSupplierAndWarehouse(tx, input.supplierId, input.warehouseId);
    await tx
      .update(purchaseOrders)
      .set({ supplierId: input.supplierId, warehouseId: input.warehouseId, expectedDate: input.expectedDate ?? null, notes: input.notes })
      .where(eq(purchaseOrders.id, id));
    await writeLines(tx, ctx, id, input.lines);
    await audit(tx, ctx, "purchase_order.updated", { type: "purchase_order", id }, { lines: input.lines.length });
  });
}

export async function issuePurchaseOrder(ctx: TenantContext, id: string) {
  requirePermission(ctx, "purchasing.write");
  await withTenantTx(ctx, async (tx) => {
    await assertDraftEditable(tx, id);
    await tx.update(purchaseOrders).set({ status: "ordered", orderedAt: new Date() }).where(eq(purchaseOrders.id, id));
    await audit(tx, ctx, "purchase_order.issued", { type: "purchase_order", id });
  });
}

/** Cancela (sin recepciones) o cierra (con recepciones parciales: el saldo pendiente ya no se espera). */
export async function cancelOrClosePurchaseOrder(ctx: TenantContext, id: string, rawReason: unknown) {
  requirePermission(ctx, "purchasing.write");
  const { reason } = parseOrThrow(z.object({ reason: z.string().trim().min(3, "Indica el motivo.").max(300) }), { reason: rawReason });
  return withTenantTx(ctx, async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
    if (!po) throw new NotFoundError("Orden de compra no encontrada.");
    let status: PurchaseOrderStatus;
    if (po.status === "draft" || po.status === "ordered") status = "cancelled";
    else if (po.status === "partially_received") status = "closed";
    else throw new ConflictError(`No se puede cancelar una orden en estado "${PO_STATUS_LABELS[po.status]}".`);
    const [active] = await tx
      .select({ n: count() })
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.purchaseOrderId, id), sql`${goodsReceipts.reversedAt} is null`));
    if (status === "cancelled" && (active?.n ?? 0) > 0) status = "closed";
    await tx.update(purchaseOrders).set({ status, closedAt: new Date() }).where(eq(purchaseOrders.id, id));
    await audit(tx, ctx, `purchase_order.${status}`, { type: "purchase_order", id }, { reason });
    return status;
  });
}

function statusFromLines(lines: { quantityOrdered: string; quantityReceived: string }[]): PurchaseOrderStatus {
  const received = lines.reduce((a, l) => a.plus(l.quantityReceived), dec(0));
  if (received.isZero()) return "ordered";
  return lines.every((l) => dec(l.quantityReceived).gte(l.quantityOrdered)) ? "received" : "partially_received";
}

const receiveSchema = z.object({
  locationId: zUuid("Ubicación"),
  notes: optionalText(1000),
  idempotencyKey: zIdempotencyKey,
  lines: z.array(z.object({ lineId: zUuid("Línea"), quantity: zQty() })).min(1, "Indica al menos una cantidad a recibir."),
});

/**
 * Recepción parcial o total. Bloquea la orden (serializa recepciones concurrentes), valida que no se reciba
 * más de lo pendiente, contabiliza la entrada al costo de la orden y actualiza el estado.
 */
export async function receivePurchaseOrder(ctx: TenantContext, purchaseOrderId: string, raw: unknown) {
  requirePermission(ctx, "purchasing.receive");
  const input = parseOrThrow(receiveSchema, raw);
  const lineIds = input.lines.map((l) => l.lineId);
  if (new Set(lineIds).size !== lineIds.length) throw new ValidationError("Una línea aparece repetida.");
  return withTenantTx(ctx, async (tx) => {
    const existing = await claimIdempotency(tx, ctx.organizationId, input.idempotencyKey, "purchase.receive");
    if (existing) return { receiptId: existing, duplicate: true };
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId)).for("update");
    if (!po) throw new NotFoundError("Orden de compra no encontrada.");
    if (po.status !== "ordered" && po.status !== "partially_received") {
      throw new ConflictError(`No se puede recibir una orden en estado "${PO_STATUS_LABELS[po.status]}".`);
    }
    const [loc] = await tx.select().from(locations).where(eq(locations.id, input.locationId));
    if (!loc || loc.warehouseId !== po.warehouseId) {
      throw new ValidationError("La ubicación debe pertenecer a la bodega de destino de la orden.", { locationId: ["Ubicación inválida."] });
    }
    const poLines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId)).for("update");
    const byId = new Map(poLines.map((l) => [l.id, l]));
    for (const l of input.lines) {
      const line = byId.get(l.lineId);
      if (!line) throw new ValidationError("Una línea no pertenece a esta orden.");
      const pending = dec(line.quantityOrdered).minus(line.quantityReceived);
      if (l.quantity.gt(pending)) {
        throw new ValidationError(`No puedes recibir más de lo pendiente (pendiente: ${pending.toString()}).`, { [`line.${l.lineId}`]: ["Excede lo pendiente."] });
      }
    }
    const posted = await postStockDocument(tx, ctx, {
      type: "purchase_receipt",
      reason: `Recepción de ${po.number}`,
      notes: input.notes,
      sourceType: "purchase_order",
      sourceId: po.id,
      lines: input.lines.map((l) => {
        const line = byId.get(l.lineId)!;
        return { variantId: line.variantId, locationId: input.locationId, quantity: l.quantity, cost: { kind: "unit", unitCost: dec(line.unitCost) } };
      }),
    });
    const number = await nextNumber(tx, ctx.organizationId, "goods_receipt");
    const [receipt] = await tx
      .insert(goodsReceipts)
      .values({
        organizationId: ctx.organizationId,
        number,
        purchaseOrderId: po.id,
        warehouseId: po.warehouseId,
        locationId: input.locationId,
        stockDocumentId: posted.documentId,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: goodsReceipts.id });
    await tx.insert(goodsReceiptLines).values(
      input.lines.map((l) => {
        const line = byId.get(l.lineId)!;
        return {
          organizationId: ctx.organizationId,
          goodsReceiptId: receipt!.id,
          purchaseOrderLineId: line.id,
          variantId: line.variantId,
          quantity: qtyStr(l.quantity),
          unitCost: line.unitCost,
        };
      }),
    );
    for (const l of input.lines) {
      await tx
        .update(purchaseOrderLines)
        .set({ quantityReceived: sql`${purchaseOrderLines.quantityReceived} + ${qtyStr(l.quantity)}::numeric` })
        .where(eq(purchaseOrderLines.id, l.lineId));
    }
    const updated = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));
    const status = statusFromLines(updated);
    await tx.update(purchaseOrders).set({ status, closedAt: status === "received" ? new Date() : null }).where(eq(purchaseOrders.id, po.id));
    await completeIdempotency(tx, ctx.organizationId, input.idempotencyKey, receipt!.id);
    await audit(tx, ctx, "purchase_order.received", { type: "goods_receipt", id: receipt!.id }, { number, purchaseOrder: po.number, status });
    return { receiptId: receipt!.id, number, status, duplicate: false };
  });
}

/** Anula una recepción: reverso al costo original (requiere que las unidades sigan en la ubicación). */
export async function reverseGoodsReceipt(ctx: TenantContext, receiptId: string, rawReason: unknown) {
  requirePermission(ctx, "purchasing.write");
  const { reason } = parseOrThrow(z.object({ reason: z.string().trim().min(3, "Indica el motivo.").max(300) }), { reason: rawReason });
  return withTenantTx(ctx, async (tx) => {
    const [receipt] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, receiptId)).for("update");
    if (!receipt) throw new NotFoundError("Recepción no encontrada.");
    if (receipt.reversedAt) throw new ConflictError("Esta recepción ya fue anulada.");
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, receipt.purchaseOrderId)).for("update");
    if (!po) throw new NotFoundError();
    const reversal = await reverseStockDocument(tx, ctx, receipt.stockDocumentId, {
      type: "purchase_receipt_reversal",
      reason,
      allowSourced: true,
    });
    const lines = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, receiptId));
    for (const l of lines) {
      await tx
        .update(purchaseOrderLines)
        .set({ quantityReceived: sql`${purchaseOrderLines.quantityReceived} - ${l.quantity}::numeric` })
        .where(eq(purchaseOrderLines.id, l.purchaseOrderLineId));
    }
    await tx.update(goodsReceipts).set({ reversedAt: new Date(), reversalDocumentId: reversal.documentId }).where(eq(goodsReceipts.id, receiptId));
    if (po.status !== "closed" && po.status !== "cancelled") {
      const updated = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
      await tx.update(purchaseOrders).set({ status: statusFromLines(updated), closedAt: null }).where(eq(purchaseOrders.id, po.id));
    }
    await audit(tx, ctx, "goods_receipt.reversed", { type: "goods_receipt", id: receiptId }, { reason, reversal: reversal.number });
    return reversal;
  });
}

export type PurchaseOrderFilters = { search?: string; status?: string; supplierId?: string; page?: number; pageSize?: number };

const poTotal = sql<string>`coalesce((select sum(l.quantity_ordered * l.unit_cost * (1 + l.tax_rate / 100)) from purchase_order_lines l where l.purchase_order_id = ${purchaseOrders.id}), 0)`;

export async function listPurchaseOrders(ctx: TenantContext, f: PurchaseOrderFilters = {}) {
  requirePermission(ctx, "purchasing.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, f.pageSize ?? 25);
  return withTenantTx(ctx, async (tx) => {
    const conds: SQL[] = [];
    if (f.status && (PURCHASE_ORDER_STATUSES as readonly string[]).includes(f.status)) conds.push(eq(purchaseOrders.status, f.status as PurchaseOrderStatus));
    if (f.supplierId) conds.push(eq(purchaseOrders.supplierId, f.supplierId));
    if (f.search) {
      const q = `%${f.search.trim()}%`;
      conds.push(or(ilike(purchaseOrders.number, q), ilike(suppliers.name, q))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await tx
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        status: purchaseOrders.status,
        createdAt: purchaseOrders.createdAt,
        expectedDate: purchaseOrders.expectedDate,
        supplierName: suppliers.name,
        warehouseName: warehouses.name,
        total: poTotal,
        progress: sql<string>`coalesce((select sum(l.quantity_received) / nullif(sum(l.quantity_ordered), 0) from purchase_order_lines l where l.purchase_order_id = ${purchaseOrders.id}), 0)`,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .innerJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
      .where(where)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx
      .select({ n: count() })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(where);
    return { rows, total: total?.n ?? 0, page, pageSize };
  });
}

export async function getPurchaseOrder(ctx: TenantContext, id: string) {
  requirePermission(ctx, "purchasing.read");
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Orden de compra no encontrada.");
  return withTenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select({ po: purchaseOrders, supplierName: suppliers.name, warehouseName: warehouses.name, userName: users.name })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .innerJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
      .innerJoin(users, eq(users.id, purchaseOrders.createdBy))
      .where(eq(purchaseOrders.id, id));
    if (!row) throw new NotFoundError("Orden de compra no encontrada.");
    const lines = await tx
      .select({
        id: purchaseOrderLines.id,
        lineNo: purchaseOrderLines.lineNo,
        variantId: purchaseOrderLines.variantId,
        sku: productVariants.sku,
        productName: products.name,
        variantName: productVariants.name,
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        quantityReceived: purchaseOrderLines.quantityReceived,
        unitCost: purchaseOrderLines.unitCost,
        taxRate: purchaseOrderLines.taxRate,
      })
      .from(purchaseOrderLines)
      .innerJoin(productVariants, eq(productVariants.id, purchaseOrderLines.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(purchaseOrderLines.purchaseOrderId, id))
      .orderBy(asc(purchaseOrderLines.lineNo));
    const receipts = await tx
      .select({
        id: goodsReceipts.id,
        number: goodsReceipts.number,
        createdAt: goodsReceipts.createdAt,
        reversedAt: goodsReceipts.reversedAt,
        stockDocumentId: goodsReceipts.stockDocumentId,
        reversalDocumentId: goodsReceipts.reversalDocumentId,
        locationCode: locations.code,
        userName: users.name,
        units: sql<string>`(select sum(quantity) from goods_receipt_lines grl where grl.goods_receipt_id = ${goodsReceipts.id})`,
      })
      .from(goodsReceipts)
      .innerJoin(locations, eq(locations.id, goodsReceipts.locationId))
      .innerJoin(users, eq(users.id, goodsReceipts.createdBy))
      .where(eq(goodsReceipts.purchaseOrderId, id))
      .orderBy(desc(goodsReceipts.createdAt));
    return { ...row.po, supplierName: row.supplierName, warehouseName: row.warehouseName, userName: row.userName, lines, receipts };
  });
}
