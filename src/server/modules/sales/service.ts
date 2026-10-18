import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  customers,
  locations,
  productVariants,
  products,
  saleLines,
  saleReturnLines,
  saleReturns,
  sales,
  taxRates,
  users,
  warehouses,
  SALE_STATUSES,
  type SaleStatus,
} from "../../db/schema";
import { withTenantTx } from "../../db/tx";
import { audit } from "../../platform/audit";
import type { TenantContext } from "../../platform/context";
import { costStr, dec, moneyStr, qtyStr, rateStr, roundMoney, ZERO } from "../../platform/decimal";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError, ValidationError } from "../../platform/errors";
import { claimIdempotency, completeIdempotency } from "../../platform/idempotency";
import { can, requirePermission } from "../../platform/permissions";
import { nextNumber } from "../../platform/sequences";
import { optionalText, parseOrThrow, zIdempotencyKey, zMoney, zQty, zUuid } from "../../platform/validation";
import { postStockDocument, reverseStockDocument } from "../inventory/posting";

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  confirmed: "Completada",
  partially_returned: "Con devolución parcial",
  returned: "Devuelta",
  cancelled: "Anulada",
};

export const PAYMENT_METHODS = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", credit: "Crédito", other: "Otro" } as const;

// ---------- Clientes ----------

const customerSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre del cliente.").max(160),
  documentNumber: optionalText(40),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || z.string().email().safeParse(v).success, "Correo inválido."),
  phone: optionalText(40),
  notes: optionalText(2000),
});

export async function listCustomers(ctx: TenantContext, f: { search?: string; page?: number; pageSize?: number } = {}) {
  requirePermission(ctx, "sales.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, f.pageSize ?? 25);
  return withTenantTx(ctx, async (tx) => {
    const conds: SQL[] = [eq(customers.status, "active")];
    if (f.search) {
      const q = `%${f.search.trim()}%`;
      conds.push(or(ilike(customers.name, q), ilike(customers.documentNumber, q), ilike(customers.phone, q), ilike(customers.email, q))!);
    }
    const where = and(...conds);
    const rows = await tx
      .select({
        customer: customers,
        salesCount: sql<number>`(select count(*)::int from sales s where s.customer_id = ${customers.id} and s.status <> 'cancelled')`,
        salesTotal: sql<string>`coalesce((select sum(s.total) from sales s where s.customer_id = ${customers.id} and s.status <> 'cancelled'), 0)`,
      })
      .from(customers)
      .where(where)
      .orderBy(asc(customers.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx.select({ n: count() }).from(customers).where(where);
    return { rows: rows.map((r) => ({ ...r.customer, salesCount: r.salesCount, salesTotal: r.salesTotal })), total: total?.n ?? 0, page, pageSize };
  });
}

export async function createCustomer(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "sales.write");
  const input = parseOrThrow(customerSchema, raw);
  try {
    return await withTenantTx(ctx, async (tx) => {
      const [c] = await tx.insert(customers).values({ organizationId: ctx.organizationId, ...input }).returning({ id: customers.id });
      await audit(tx, ctx, "customer.created", { type: "customer", id: c!.id }, { name: input.name });
      return c!.id;
    });
  } catch (err) {
    if (isUniqueViolation(err, "customers_org_doc_uq")) throw new ValidationError("Ya existe un cliente con ese documento.", { documentNumber: ["Repetido."] });
    throw err;
  }
}

export async function updateCustomer(ctx: TenantContext, id: string, raw: unknown) {
  requirePermission(ctx, "sales.write");
  const input = parseOrThrow(customerSchema, raw);
  try {
    await withTenantTx(ctx, async (tx) => {
      const updated = await tx.update(customers).set(input).where(eq(customers.id, id)).returning({ id: customers.id });
      if (updated.length === 0) throw new NotFoundError("Cliente no encontrado.");
      await audit(tx, ctx, "customer.updated", { type: "customer", id }, { name: input.name });
    });
  } catch (err) {
    if (isUniqueViolation(err, "customers_org_doc_uq")) throw new ValidationError("Ya existe un cliente con ese documento.", { documentNumber: ["Repetido."] });
    throw err;
  }
}

export async function archiveCustomer(ctx: TenantContext, id: string) {
  requirePermission(ctx, "sales.manage");
  await withTenantTx(ctx, async (tx) => {
    const updated = await tx.update(customers).set({ status: "archived" }).where(eq(customers.id, id)).returning({ id: customers.id });
    if (updated.length === 0) throw new NotFoundError("Cliente no encontrado.");
    await audit(tx, ctx, "customer.archived", { type: "customer", id });
  });
}

export async function getCustomer(ctx: TenantContext, id: string) {
  requirePermission(ctx, "sales.read");
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Cliente no encontrado.");
  const [c] = await withTenantTx(ctx, (tx) => tx.select().from(customers).where(eq(customers.id, id)));
  if (!c) throw new NotFoundError("Cliente no encontrado.");
  return c;
}

// ---------- Ventas ----------

const saleSchema = z.object({
  customerId: zUuid("Cliente").optional().nullable().or(z.literal("").transform(() => null)),
  locationId: zUuid("Ubicación"),
  paymentMethod: z.enum(["cash", "card", "transfer", "credit", "other"]),
  notes: optionalText(1000),
  idempotencyKey: zIdempotencyKey,
  lines: z
    .array(
      z.object({
        variantId: zUuid("Producto"),
        quantity: zQty(),
        unitPrice: zMoney("El precio").optional(),
        discount: zMoney("El descuento").optional(),
      }),
    )
    .min(1, "Agrega al menos un producto.")
    .max(200),
});

/**
 * Registra una venta confirmada: descuenta inventario al costo promedio y guarda precio, impuesto y costo
 * de cada línea. Cambiar precios o aplicar descuentos requiere el permiso sales.manage.
 */
export async function createSale(ctx: TenantContext, raw: unknown) {
  requirePermission(ctx, "sales.write");
  const input = parseOrThrow(saleSchema, raw);
  const ids = input.lines.map((l) => l.variantId);
  if (new Set(ids).size !== ids.length) throw new ValidationError("Un producto aparece repetido. Ajusta la cantidad en una sola línea.");

  return withTenantTx(ctx, async (tx) => {
    const existing = await claimIdempotency(tx, ctx.organizationId, input.idempotencyKey, "sale.create");
    if (existing) return { saleId: existing, duplicate: true };

    const [loc] = await tx.select().from(locations).where(eq(locations.id, input.locationId));
    if (!loc) throw new ValidationError("Ubicación no encontrada.", { locationId: ["Selecciona una ubicación."] });
    if (input.customerId) {
      const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, input.customerId));
      if (!c) throw new ValidationError("Cliente no encontrado.", { customerId: ["Selecciona un cliente válido."] });
    }
    const variants = await tx
      .select({ id: productVariants.id, sku: productVariants.sku, salePrice: productVariants.salePrice, taxRate: sql<string>`coalesce(${taxRates.rate}, 0)` })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(taxRates, eq(taxRates.id, products.taxRateId))
      .where(inArray(productVariants.id, ids));
    const byId = new Map(variants.map((v) => [v.id, v]));

    const priced = input.lines.map((l) => {
      const v = byId.get(l.variantId);
      if (!v) throw new NotFoundError("Producto no encontrado.");
      const listPrice = dec(v.salePrice);
      const unitPrice = l.unitPrice ?? listPrice;
      const discount = l.discount ?? ZERO;
      if ((!unitPrice.eq(listPrice) || discount.gt(0)) && !can(ctx, "sales.manage")) {
        throw new ForbiddenError(`Solo un gerente o administrador puede cambiar el precio o aplicar descuentos (${v.sku}).`);
      }
      const gross = roundMoney(l.quantity.times(unitPrice));
      if (discount.gt(gross)) throw new ValidationError(`El descuento de ${v.sku} supera el valor de la línea.`);
      const subtotal = gross.minus(discount);
      const rate = dec(v.taxRate);
      const tax = roundMoney(subtotal.times(rate).div(100));
      return { ...l, unitPrice, discount, gross, subtotal, rate, tax, total: subtotal.plus(tax) };
    });

    const number = await nextNumber(tx, ctx.organizationId, "sale");
    const saleId = randomUUID();
    const posted = await postStockDocument(tx, ctx, {
      type: "sale",
      reason: `Venta ${number}`,
      sourceType: "sale",
      sourceId: saleId,
      lines: priced.map((l) => ({ variantId: l.variantId, locationId: input.locationId, quantity: l.quantity.neg(), cost: { kind: "average" } })),
    });
    const costByVariant = new Map(posted.movements.map((m) => [m.variantId, m]));
    const sum = (f: (l: (typeof priced)[number]) => ReturnType<typeof dec>) => priced.reduce((a, l) => a.plus(f(l)), ZERO);
    const costTotal = posted.movements.reduce((a, m) => a.plus(m.totalCost.abs()), ZERO);

    const [sale] = await tx
      .insert(sales)
      .values({
        id: saleId,
        organizationId: ctx.organizationId,
        number,
        customerId: input.customerId ?? null,
        warehouseId: loc.warehouseId,
        locationId: loc.id,
        subtotal: moneyStr(sum((l) => l.gross)),
        discountTotal: moneyStr(sum((l) => l.discount)),
        taxTotal: moneyStr(sum((l) => l.tax)),
        total: moneyStr(sum((l) => l.total)),
        costTotal: moneyStr(costTotal),
        paymentMethod: input.paymentMethod,
        notes: input.notes,
        stockDocumentId: posted.documentId,
        createdBy: ctx.userId,
      })
      .returning({ id: sales.id });
    await tx.insert(saleLines).values(
      priced.map((l, i) => {
        const m = costByVariant.get(l.variantId)!;
        return {
          organizationId: ctx.organizationId,
          saleId: sale!.id,
          lineNo: i + 1,
          variantId: l.variantId,
          quantity: qtyStr(l.quantity),
          unitPrice: moneyStr(l.unitPrice),
          discount: moneyStr(l.discount),
          taxRate: rateStr(l.rate),
          lineSubtotal: moneyStr(l.subtotal),
          lineTax: moneyStr(l.tax),
          lineTotal: moneyStr(l.total),
          unitCost: costStr(m.unitCost),
          lineCost: moneyStr(m.totalCost.abs()),
        };
      }),
    );
    await completeIdempotency(tx, ctx.organizationId, input.idempotencyKey, sale!.id);
    await audit(tx, ctx, "sale.created", { type: "sale", id: sale!.id }, { number, total: moneyStr(sum((l) => l.total)) });
    return { saleId: sale!.id, number, duplicate: false };
  });
}

const reasonSchema = z.string().trim().min(3, "Indica el motivo (mínimo 3 caracteres).").max(300);

/** Anula una venta sin devoluciones: reingresa las unidades al costo con que salieron. */
export async function cancelSale(ctx: TenantContext, saleId: string, rawReason: unknown) {
  requirePermission(ctx, "sales.manage");
  const { reason } = parseOrThrow(z.object({ reason: reasonSchema }), { reason: rawReason });
  return withTenantTx(ctx, async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).for("update");
    if (!sale) throw new NotFoundError("Venta no encontrada.");
    if (sale.status === "cancelled") throw new ConflictError("La venta ya está anulada.");
    if (sale.status !== "confirmed") throw new ConflictError("La venta tiene devoluciones: registra la devolución del resto en lugar de anularla.");
    const reversal = await reverseStockDocument(tx, ctx, sale.stockDocumentId, {
      type: "sale_cancellation",
      reason,
      sourceType: "sale",
      sourceId: sale.id,
      allowSourced: true,
    });
    await tx
      .update(sales)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason, cancellationDocumentId: reversal.documentId })
      .where(eq(sales.id, saleId));
    await audit(tx, ctx, "sale.cancelled", { type: "sale", id: saleId }, { number: sale.number, reason });
    return reversal;
  });
}

const returnSchema = z.object({
  reason: reasonSchema,
  idempotencyKey: zIdempotencyKey,
  lines: z.array(z.object({ saleLineId: zUuid("Línea"), quantity: zQty() })).min(1, "Indica al menos una cantidad a devolver."),
});

/** Devolución parcial o total: las unidades vuelven a la ubicación de la venta al costo original de la línea. */
export async function returnSale(ctx: TenantContext, saleId: string, raw: unknown) {
  requirePermission(ctx, "sales.manage");
  const input = parseOrThrow(returnSchema, raw);
  const ids = input.lines.map((l) => l.saleLineId);
  if (new Set(ids).size !== ids.length) throw new ValidationError("Una línea aparece repetida.");
  return withTenantTx(ctx, async (tx) => {
    const existing = await claimIdempotency(tx, ctx.organizationId, input.idempotencyKey, "sale.return");
    if (existing) return { returnId: existing, duplicate: true };
    const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).for("update");
    if (!sale) throw new NotFoundError("Venta no encontrada.");
    if (sale.status === "cancelled" || sale.status === "returned") throw new ConflictError("Esta venta no admite más devoluciones.");
    const lines = await tx.select().from(saleLines).where(eq(saleLines.saleId, saleId)).for("update");
    const byId = new Map(lines.map((l) => [l.id, l]));
    const items = input.lines.map((l) => {
      const line = byId.get(l.saleLineId);
      if (!line) throw new ValidationError("Una línea no pertenece a esta venta.");
      const pending = dec(line.quantity).minus(line.quantityReturned);
      if (l.quantity.gt(pending)) throw new ValidationError(`No puedes devolver más de lo vendido (pendiente: ${pending.toString()}).`);
      const isLast = l.quantity.eq(pending);
      const lineTotal = dec(line.lineTotal);
      // El reembolso es proporcional; la última devolución de la línea toma el saldo exacto.
      const refunded = roundMoney(lineTotal.times(dec(line.quantityReturned)).div(line.quantity));
      const refund = isLast ? lineTotal.minus(refunded) : roundMoney(lineTotal.times(l.quantity).div(line.quantity));
      return { line, quantity: l.quantity, refund, unitCost: dec(line.unitCost) };
    });
    const number = await nextNumber(tx, ctx.organizationId, "sale_return");
    const posted = await postStockDocument(tx, ctx, {
      type: "sale_return",
      reason: `${input.reason} (${number})`,
      sourceType: "sale",
      sourceId: sale.id,
      allowArchived: true,
      lines: items.map((i) => ({ variantId: i.line.variantId, locationId: sale.locationId, quantity: i.quantity, cost: { kind: "unit", unitCost: i.unitCost } })),
    });
    const refundTotal = items.reduce((a, i) => a.plus(i.refund), ZERO);
    const [ret] = await tx
      .insert(saleReturns)
      .values({
        organizationId: ctx.organizationId,
        number,
        saleId,
        reason: input.reason,
        refundTotal: moneyStr(refundTotal),
        stockDocumentId: posted.documentId,
        createdBy: ctx.userId,
      })
      .returning({ id: saleReturns.id });
    await tx.insert(saleReturnLines).values(
      items.map((i) => ({
        organizationId: ctx.organizationId,
        saleReturnId: ret!.id,
        saleLineId: i.line.id,
        quantity: qtyStr(i.quantity),
        unitCost: costStr(i.unitCost),
        refundAmount: moneyStr(i.refund),
      })),
    );
    for (const i of items) {
      await tx
        .update(saleLines)
        .set({ quantityReturned: sql`${saleLines.quantityReturned} + ${qtyStr(i.quantity)}::numeric` })
        .where(eq(saleLines.id, i.line.id));
    }
    const after = await tx.select().from(saleLines).where(eq(saleLines.saleId, saleId));
    const fully = after.every((l) => dec(l.quantityReturned).eq(l.quantity));
    await tx.update(sales).set({ status: fully ? "returned" : "partially_returned" }).where(eq(sales.id, saleId));
    await completeIdempotency(tx, ctx.organizationId, input.idempotencyKey, ret!.id);
    await audit(tx, ctx, "sale.returned", { type: "sale_return", id: ret!.id }, { sale: sale.number, number, refund: moneyStr(refundTotal) });
    return { returnId: ret!.id, number, duplicate: false };
  });
}

export type SaleFilters = { search?: string; status?: string; from?: string; to?: string; customerId?: string; page?: number; pageSize?: number };

export async function listSales(ctx: TenantContext, f: SaleFilters = {}) {
  requirePermission(ctx, "sales.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, f.pageSize ?? 25);
  return withTenantTx(ctx, async (tx) => {
    const conds: SQL[] = [];
    if (f.status && (SALE_STATUSES as readonly string[]).includes(f.status)) conds.push(eq(sales.status, f.status as SaleStatus));
    if (f.customerId) conds.push(eq(sales.customerId, f.customerId));
    if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(sales.createdAt, new Date(`${f.from}T00:00:00`)));
    if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(sales.createdAt, new Date(`${f.to}T23:59:59.999`)));
    if (f.search) {
      const q = `%${f.search.trim()}%`;
      conds.push(or(ilike(sales.number, q), ilike(customers.name, q))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await tx
      .select({
        id: sales.id,
        number: sales.number,
        status: sales.status,
        createdAt: sales.createdAt,
        total: sales.total,
        costTotal: sales.costTotal,
        paymentMethod: sales.paymentMethod,
        customerName: customers.name,
        userName: users.name,
        items: sql<string>`(select sum(quantity) from sale_lines sl where sl.sale_id = ${sales.id})`,
      })
      .from(sales)
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .innerJoin(users, eq(users.id, sales.createdBy))
      .where(where)
      .orderBy(desc(sales.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await tx
      .select({ n: count() })
      .from(sales)
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .where(where);
    return { rows, total: total?.n ?? 0, page, pageSize };
  });
}

export async function getSale(ctx: TenantContext, id: string) {
  requirePermission(ctx, "sales.read");
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Venta no encontrada.");
  return withTenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select({ sale: sales, customerName: customers.name, userName: users.name, warehouseName: warehouses.name, locationCode: locations.code })
      .from(sales)
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .innerJoin(users, eq(users.id, sales.createdBy))
      .innerJoin(warehouses, eq(warehouses.id, sales.warehouseId))
      .innerJoin(locations, eq(locations.id, sales.locationId))
      .where(eq(sales.id, id));
    if (!row) throw new NotFoundError("Venta no encontrada.");
    const lines = await tx
      .select({ line: saleLines, sku: productVariants.sku, productName: products.name, variantName: productVariants.name })
      .from(saleLines)
      .innerJoin(productVariants, eq(productVariants.id, saleLines.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(saleLines.saleId, id))
      .orderBy(asc(saleLines.lineNo));
    const returns = await tx
      .select({ ret: saleReturns, userName: users.name })
      .from(saleReturns)
      .innerJoin(users, eq(users.id, saleReturns.createdBy))
      .where(eq(saleReturns.saleId, id))
      .orderBy(desc(saleReturns.createdAt));
    return {
      ...row.sale,
      customerName: row.customerName,
      userName: row.userName,
      warehouseName: row.warehouseName,
      locationCode: row.locationCode,
      lines: lines.map((l) => ({ ...l.line, sku: l.sku, productName: l.productName, variantName: l.variantName })),
      returns: returns.map((r) => ({ ...r.ret, userName: r.userName })),
    };
  });
}
