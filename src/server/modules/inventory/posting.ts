import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import {
  locations,
  productVariants,
  products,
  stockBalances,
  stockDocuments,
  stockMovements,
  stockValuations,
  warehouses,
  type StockDocumentType,
} from "../../db/schema";
import type { TenantContext } from "../../platform/context";
import { costStr, dec, moneyStr, qtyStr, ZERO, type Dec } from "../../platform/decimal";
import { ConflictError, InsufficientStockError, isUniqueViolation, NotFoundError, ValidationError } from "../../platform/errors";
import { nextNumber } from "../../platform/sequences";
import { avgOf, CostingError, inbound, inboundAtUnitCost, outboundAtAverage, outboundAtTotal, type CostResult, type ValuationState } from "../costing/average";

// Motor único de contabilización de inventario. Toda variación de stock pasa por aquí:
// documento + movimientos inmutables + saldos por ubicación + valoración por bodega, en una transacción.

export type CostSpec =
  | { kind: "unit"; unitCost: Dec }
  | { kind: "total"; totalCost: Dec }
  | { kind: "average" }
  /** Entrada valorada con el costo total de otra línea (índice 0-based) ya procesada: transferencias. */
  | { kind: "sameAsLine"; index: number };

export type PostLine =
  | { variantId: string; locationId: string; quantity: Dec; cost: CostSpec }
  /** Conteo físico: la diferencia con el saldo se calcula bajo bloqueo. Las sobrantes entran al costo indicado o al promedio. */
  | { variantId: string; locationId: string; counted: Dec; unitCost?: Dec };

export type PostInput = {
  type: StockDocumentType;
  reason: string;
  notes?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  reversesDocumentId?: string | null;
  lines: PostLine[];
  /** Permite mover variantes, bodegas o ubicaciones archivadas (reversos y devoluciones). */
  allowArchived?: boolean;
};

export type PostedMovement = {
  lineNo: number;
  variantId: string;
  warehouseId: string;
  locationId: string;
  quantity: Dec;
  unitCost: Dec;
  totalCost: Dec;
};

export type PostResult = { documentId: string; number: string; movements: PostedMovement[] };

const pairKey = (a: string, b: string) => `${a}|${b}`;

export async function postStockDocument(tx: Tx, ctx: TenantContext, input: PostInput): Promise<PostResult> {
  if (input.lines.length === 0) throw new ValidationError("El documento no tiene líneas.");
  if (input.lines.length > 500) throw new ValidationError("Un documento admite como máximo 500 líneas.");
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError("Indica el motivo del movimiento.", { reason: ["Obligatorio."] });

  // 1. Ubicaciones y variantes (RLS garantiza que pertenecen a la empresa).
  const locationIds = [...new Set(input.lines.map((l) => l.locationId))];
  const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
  const locRows = await tx
    .select({
      id: locations.id,
      code: locations.code,
      status: locations.status,
      warehouseId: locations.warehouseId,
      warehouseName: warehouses.name,
      warehouseStatus: warehouses.status,
    })
    .from(locations)
    .innerJoin(warehouses, and(eq(warehouses.id, locations.warehouseId), eq(warehouses.organizationId, locations.organizationId)))
    .where(inArray(locations.id, locationIds));
  const locById = new Map(locRows.map((l) => [l.id, l]));
  const varRows = await tx
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      status: productVariants.status,
      label: sql<string>`${products.name} || case when ${productVariants.name} <> '' then ' ' || ${productVariants.name} else '' end`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, variantIds));
  const varById = new Map(varRows.map((v) => [v.id, v]));
  for (const id of locationIds) {
    const loc = locById.get(id);
    if (!loc) throw new NotFoundError("Ubicación no encontrada.");
    if (!input.allowArchived && (loc.status !== "active" || loc.warehouseStatus !== "active")) {
      throw new ValidationError(`La ubicación ${loc.warehouseName} / ${loc.code} está archivada.`);
    }
  }
  for (const id of variantIds) {
    const v = varById.get(id);
    if (!v) throw new NotFoundError("Producto no encontrado.");
    if (!input.allowArchived && v.status !== "active") throw new ValidationError(`El producto ${v.sku} está archivado.`);
  }

  // 2. Asegura filas de saldo y valoración, y las bloquea en orden determinista (evita deadlocks).
  const valPairs = new Map<string, { variantId: string; warehouseId: string }>();
  const balPairs = new Map<string, { variantId: string; warehouseId: string; locationId: string }>();
  for (const l of input.lines) {
    const warehouseId = locById.get(l.locationId)!.warehouseId;
    valPairs.set(pairKey(l.variantId, warehouseId), { variantId: l.variantId, warehouseId });
    balPairs.set(pairKey(l.variantId, l.locationId), { variantId: l.variantId, warehouseId, locationId: l.locationId });
  }
  await tx
    .insert(stockValuations)
    .values([...valPairs.values()].map((p) => ({ organizationId: ctx.organizationId, ...p })))
    .onConflictDoNothing();
  await tx
    .insert(stockBalances)
    .values([...balPairs.values()].map((p) => ({ organizationId: ctx.organizationId, ...p })))
    .onConflictDoNothing();

  const valTuples = sql.join(
    [...valPairs.values()].map((p) => sql`(${p.variantId}::uuid, ${p.warehouseId}::uuid)`),
    sql`, `,
  );
  const lockedVals = await tx
    .select()
    .from(stockValuations)
    .where(sql`(${stockValuations.variantId}, ${stockValuations.warehouseId}) in (${valTuples})`)
    .orderBy(asc(stockValuations.variantId), asc(stockValuations.warehouseId))
    .for("update");
  const balTuples = sql.join(
    [...balPairs.values()].map((p) => sql`(${p.variantId}::uuid, ${p.locationId}::uuid)`),
    sql`, `,
  );
  const lockedBals = await tx
    .select()
    .from(stockBalances)
    .where(sql`(${stockBalances.variantId}, ${stockBalances.locationId}) in (${balTuples})`)
    .orderBy(asc(stockBalances.variantId), asc(stockBalances.locationId))
    .for("update");

  const valState = new Map<string, ValuationState>(
    lockedVals.map((v) => [pairKey(v.variantId, v.warehouseId), { quantity: dec(v.quantity), value: dec(v.totalValue) }]),
  );
  const balState = new Map<string, Dec>(lockedBals.map((b) => [pairKey(b.variantId, b.locationId), dec(b.onHand)]));

  // 3. Aplica las líneas en orden.
  type Pending = PostedMovement & { locationQtyAfter: Dec; warehouseQtyAfter: Dec; warehouseValueAfter: Dec; avgCostAfter: Dec };
  const pending: Pending[] = [];
  let lineNo = 0;
  const costByInputIndex: Dec[] = [];
  for (const [inputIndex, line] of input.lines.entries()) {
    const loc = locById.get(line.locationId)!;
    const variant = varById.get(line.variantId)!;
    const vKey = pairKey(line.variantId, loc.warehouseId);
    const bKey = pairKey(line.variantId, line.locationId);
    const val = valState.get(vKey)!;
    const onHand = balState.get(bKey)!;

    let quantity: Dec;
    let cost: CostSpec;
    if ("counted" in line) {
      if (line.counted.lt(0)) throw new ValidationError(`El conteo de ${variant.sku} no puede ser negativo.`);
      quantity = line.counted.minus(onHand);
      if (quantity.isZero()) {
        costByInputIndex[inputIndex] = ZERO;
        continue;
      }
      cost = quantity.gt(0) && line.unitCost ? { kind: "unit", unitCost: line.unitCost } : { kind: "average" };
    } else {
      quantity = line.quantity;
      cost = line.cost;
    }
    if (quantity.isZero()) throw new ValidationError(`La cantidad de ${variant.sku} no puede ser cero.`);

    if (cost.kind === "sameAsLine") {
      const linked = costByInputIndex[cost.index];
      if (linked === undefined || cost.index >= inputIndex) throw new ValidationError("Referencia de costo inválida.");
      cost = { kind: "total", totalCost: linked };
    }

    let result: CostResult;
    try {
      if (quantity.gt(0)) {
        if (cost.kind === "unit") result = inboundAtUnitCost(val, quantity, cost.unitCost);
        else if (cost.kind === "total") result = inbound(val, quantity, cost.totalCost);
        else {
          const avg = avgOf(val);
          if (val.quantity.isZero()) {
            throw new ValidationError(`${variant.sku} no tiene costo promedio en ${loc.warehouseName}: indica el costo unitario de la entrada.`);
          }
          result = inboundAtUnitCost(val, quantity, avg);
        }
      } else {
        const q = quantity.neg();
        if (onHand.lt(q)) {
          throw new InsufficientStockError({
            sku: variant.label,
            location: loc.code === "GENERAL" ? loc.warehouseName : `${loc.warehouseName} (${loc.code})`,
            available: onHand.toString(),
            requested: q.toString(),
          });
        }
        result = cost.kind === "total" ? outboundAtTotal(val, q, cost.totalCost) : outboundAtAverage(val, q);
      }
    } catch (err) {
      if (err instanceof CostingError) throw new ValidationError(`${variant.sku}: ${err.message}`);
      throw err;
    }

    costByInputIndex[inputIndex] = result.totalCost;
    const newOnHand = onHand.plus(quantity);
    valState.set(vKey, result.state);
    balState.set(bKey, newOnHand);
    lineNo++;
    pending.push({
      lineNo,
      variantId: line.variantId,
      warehouseId: loc.warehouseId,
      locationId: line.locationId,
      quantity,
      unitCost: result.unitCost,
      totalCost: quantity.gt(0) ? result.totalCost : result.totalCost.neg(),
      locationQtyAfter: newOnHand,
      warehouseQtyAfter: result.state.quantity,
      warehouseValueAfter: result.state.value,
      avgCostAfter: result.avgCost,
    });
  }
  if (pending.length === 0) throw new ValidationError("No hay diferencias que registrar.");

  // 4. Persiste documento, movimientos y saldos.
  const number = await nextNumber(tx, ctx.organizationId, "stock_document");
  let documentId: string;
  try {
    const [doc] = await tx
      .insert(stockDocuments)
      .values({
        organizationId: ctx.organizationId,
        number,
        type: input.type,
        reason,
        notes: input.notes?.trim() || null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        reversesDocumentId: input.reversesDocumentId ?? null,
        createdBy: ctx.userId,
      })
      .returning({ id: stockDocuments.id });
    documentId = doc!.id;
  } catch (err) {
    if (isUniqueViolation(err, "stock_documents_reverses_uq")) throw new ConflictError("Este documento ya fue reversado.", "already_reversed");
    throw err;
  }

  await tx.insert(stockMovements).values(
    pending.map((m) => ({
      organizationId: ctx.organizationId,
      documentId,
      lineNo: m.lineNo,
      variantId: m.variantId,
      warehouseId: m.warehouseId,
      locationId: m.locationId,
      quantity: qtyStr(m.quantity),
      unitCost: costStr(m.unitCost),
      totalCost: moneyStr(m.totalCost),
      locationQtyAfter: qtyStr(m.locationQtyAfter),
      warehouseQtyAfter: qtyStr(m.warehouseQtyAfter),
      warehouseValueAfter: moneyStr(m.warehouseValueAfter),
      avgCostAfter: costStr(m.avgCostAfter),
      createdBy: ctx.userId,
    })),
  );

  const now = new Date();
  for (const [key, state] of valState) {
    const [variantId, warehouseId] = key.split("|") as [string, string];
    await tx
      .update(stockValuations)
      .set({ quantity: qtyStr(state.quantity), totalValue: moneyStr(state.value), avgCost: costStr(avgOf(state)), updatedAt: now })
      .where(
        and(
          eq(stockValuations.organizationId, ctx.organizationId),
          eq(stockValuations.variantId, variantId),
          eq(stockValuations.warehouseId, warehouseId),
        ),
      );
  }
  for (const [key, onHand] of balState) {
    const [variantId, locationId] = key.split("|") as [string, string];
    await tx
      .update(stockBalances)
      .set({ onHand: qtyStr(onHand), updatedAt: now })
      .where(and(eq(stockBalances.organizationId, ctx.organizationId), eq(stockBalances.variantId, variantId), eq(stockBalances.locationId, locationId)));
  }

  return {
    documentId,
    number,
    movements: pending.map(({ lineNo, variantId, warehouseId, locationId, quantity, unitCost, totalCost }) => ({
      lineNo,
      variantId,
      warehouseId,
      locationId,
      quantity,
      unitCost,
      totalCost,
    })),
  };
}

const NON_REVERSIBLE: StockDocumentType[] = ["reversal", "purchase_receipt_reversal", "sale_cancellation", "sale_return"];

/**
 * Reversa un documento creando movimientos opuestos al costo original. El original no se modifica;
 * el índice único sobre reverses_document_id impide reversarlo dos veces.
 */
export async function reverseStockDocument(
  tx: Tx,
  ctx: TenantContext,
  documentId: string,
  opts: { type: StockDocumentType; reason: string; sourceType?: string | null; sourceId?: string | null; allowSourced?: boolean },
): Promise<PostResult> {
  const [original] = await tx.select().from(stockDocuments).where(eq(stockDocuments.id, documentId));
  if (!original) throw new NotFoundError("Documento no encontrado.");
  if (NON_REVERSIBLE.includes(original.type)) throw new ValidationError("Este tipo de documento no se puede reversar.");
  if (original.sourceType && !opts.allowSourced) {
    throw new ValidationError("Este movimiento pertenece a una compra o venta: anúlalo desde ese módulo.");
  }
  const [already] = await tx
    .select({ id: stockDocuments.id })
    .from(stockDocuments)
    .where(eq(stockDocuments.reversesDocumentId, documentId));
  if (already) throw new ConflictError("Este documento ya fue reversado.", "already_reversed");

  const moves = await tx
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.documentId, documentId))
    .orderBy(asc(stockMovements.lineNo));
  const lines: PostLine[] = moves.reverse().map((m) => ({
    variantId: m.variantId,
    locationId: m.locationId,
    quantity: dec(m.quantity).neg(),
    cost: { kind: "total", totalCost: dec(m.totalCost).abs() },
  }));
  return postStockDocument(tx, ctx, {
    type: opts.type,
    reason: opts.reason,
    notes: `Reverso de ${original.number}`,
    sourceType: opts.sourceType ?? original.sourceType,
    sourceId: opts.sourceId ?? original.sourceId,
    reversesDocumentId: documentId,
    lines,
    allowArchived: true,
  });
}

export { ZERO };
