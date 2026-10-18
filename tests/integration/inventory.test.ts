import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { stockMovements } from "@/server/db/schema";
import { withTenantTx } from "@/server/db/tx";
import { getProduct } from "@/server/modules/catalog/service";
import { getDocument, listMovements, lowStock, postManualDocument, reconcile, reverseDocument, stockByVariant } from "@/server/modules/inventory/service";
import { createLocation, createWarehouse, getWarehouse } from "@/server/modules/warehouses/service";
import { createOrg, createVariant, expectPgError, expectReject, memberCtx, type OrgFixture } from "./helpers";

const qtyOf = async (org: OrgFixture, productId: string) => (await getProduct(org.owner, productId)).variants[0]!;

describe("movimientos de inventario", () => {
  let org: OrgFixture;
  let secondWarehouse: { warehouseId: string; locationId: string };

  beforeAll(async () => {
    org = await createOrg("Inventario SA");
    const wh = await createWarehouse(org.owner, { code: "TIENDA2", name: "Tienda centro" });
    const detail = await getWarehouse(org.owner, wh!);
    secondWarehouse = { warehouseId: wh!, locationId: detail.locations[0]!.id };
  });

  it("entradas recalculan el promedio ponderado y salidas usan el costo vigente", async () => {
    const v = await createVariant(org.owner);
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Compra local", lines: [{ variantId: v.variantId, quantity: "10", unitCost: "100" }] });
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Compra local", lines: [{ variantId: v.variantId, quantity: "10", unitCost: "200" }] });
    const out = await postManualDocument(org.owner, { type: "issue", locationId: org.locationId, reason: "Consumo interno", lines: [{ variantId: v.variantId, quantity: "5" }] });
    const doc = await getDocument(org.owner, out.documentId);
    expect(doc.lines[0]!.unitCost).toBe("150.000000");
    expect(doc.lines[0]!.totalCost).toBe("-750.0000");
    const variant = await qtyOf(org, v.productId);
    expect(variant.quantity).toBe("15.0000");
    expect(variant.value).toBe("2250.0000");
  });

  it("impide inventario negativo y no deja rastros si la operación falla", async () => {
    const v = await createVariant(org.owner);
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "2", unitCost: "50" }] });
    const before = (await listMovements(org.owner, { variantId: v.variantId })).total;
    await expectReject(
      postManualDocument(org.owner, { type: "issue", locationId: org.locationId, reason: "Salida", lines: [{ variantId: v.variantId, quantity: "3" }] }),
      "InsufficientStockError",
    );
    expect((await listMovements(org.owner, { variantId: v.variantId })).total).toBe(before);
    expect((await qtyOf(org, v.productId)).quantity).toBe("2.0000");
  });

  it("ajuste por conteo físico registra solo la diferencia", async () => {
    const v = await createVariant(org.owner);
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "10", unitCost: "30" }] });
    const adj = await postManualDocument(org.owner, { type: "adjustment", locationId: org.locationId, reason: "Conteo mensual", lines: [{ variantId: v.variantId, counted: "7" }] });
    const doc = await getDocument(org.owner, adj.documentId);
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]!.quantity).toBe("-3.0000");
    await expectReject(
      postManualDocument(org.owner, { type: "adjustment", locationId: org.locationId, reason: "Conteo mensual", lines: [{ variantId: v.variantId, counted: "7" }] }),
      "ValidationError",
    );
  });

  it("transferencia entre bodegas traslada cantidad y costo de forma atómica", async () => {
    const v = await createVariant(org.owner);
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "4", unitCost: "250" }] });
    await postManualDocument(org.owner, {
      type: "transfer",
      fromLocationId: org.locationId,
      toLocationId: secondWarehouse.locationId,
      reason: "Surtir tienda",
      lines: [{ variantId: v.variantId, quantity: "3" }],
    });
    const stock = await stockByVariant(org.owner, v.variantId);
    const byWh = Object.fromEntries(stock.byWarehouse.map((w) => [w.warehouseId, w]));
    expect(byWh[org.warehouseId]!.quantity).toBe("1.0000");
    expect(byWh[org.warehouseId]!.totalValue).toBe("250.0000");
    expect(byWh[secondWarehouse.warehouseId]!.quantity).toBe("3.0000");
    expect(byWh[secondWarehouse.warehouseId]!.avgCost).toBe("250.000000");
    // Transferir más de lo disponible falla sin mover nada.
    await expectReject(
      postManualDocument(org.owner, { type: "transfer", fromLocationId: org.locationId, toLocationId: secondWarehouse.locationId, reason: "Exceso", lines: [{ variantId: v.variantId, quantity: "2" }] }),
      "InsufficientStockError",
    );
    expect((await stockByVariant(org.owner, v.variantId)).byWarehouse.find((w) => w.warehouseId === secondWarehouse.warehouseId)!.quantity).toBe("3.0000");
  });

  it("transferencia entre ubicaciones de la misma bodega no cambia la valoración", async () => {
    const v = await createVariant(org.owner);
    const bin = await createLocation(org.owner, org.warehouseId, { code: "VITRINA", name: "Vitrina" });
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "3", unitCost: "10" }] });
    await postManualDocument(org.owner, { type: "transfer", fromLocationId: org.locationId, toLocationId: bin!, reason: "Exhibición", lines: [{ variantId: v.variantId, quantity: "2" }] });
    const stock = await stockByVariant(org.owner, v.variantId);
    expect(stock.byWarehouse[0]).toMatchObject({ quantity: "3.0000", totalValue: "30.0000" });
    expect(stock.byLocation.map((l) => l.onHand).sort()).toEqual(["1.0000", "2.0000"]);
  });

  it("el reverso crea movimientos compensatorios y no puede repetirse", async () => {
    const v = await createVariant(org.owner);
    const r = await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga errónea", lines: [{ variantId: v.variantId, quantity: "5", unitCost: "80" }] });
    const rev = await reverseDocument(org.owner, r.documentId, "Cantidad equivocada");
    const original = await getDocument(org.owner, r.documentId);
    expect(original.reversedBy?.id).toBe(rev.documentId);
    expect((await qtyOf(org, v.productId)).quantity).toBe("0.0000");
    expect((await listMovements(org.owner, { variantId: v.variantId })).total).toBe(2);
    await expectReject(reverseDocument(org.owner, r.documentId, "Otra vez"), "ConflictError");
    await expectReject(reverseDocument(org.owner, rev.documentId, "Reverso de reverso"), "ValidationError");
  });

  it("los movimientos son inmutables a nivel de base de datos", async () => {
    const v = await createVariant(org.owner);
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "1", unitCost: "1" }] });
    await expectPgError(withTenantTx(org.owner, (tx) => tx.update(stockMovements).set({ quantity: "100" }).where(eq(stockMovements.variantId, v.variantId))), "42501");
    await expectPgError(withTenantTx(org.owner, (tx) => tx.delete(stockMovements).where(eq(stockMovements.variantId, v.variantId))), "42501");
    await expectPgError(withTenantTx(org.owner, (tx) => tx.execute(sql`update stock_balances set on_hand = -1 where variant_id = ${v.variantId}`)), "23514");
  });

  it("valida motivo, cantidades y productos repetidos", async () => {
    const v = await createVariant(org.owner);
    await expectReject(postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "", lines: [{ variantId: v.variantId, quantity: "1", unitCost: "1" }] }), "ValidationError");
    await expectReject(postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "-1", unitCost: "1" }] }), "ValidationError");
    await expectReject(postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "1.123456", unitCost: "1" }] }), "ValidationError");
    await expectReject(
      postManualDocument(org.owner, {
        type: "receipt",
        locationId: org.locationId,
        reason: "Carga",
        lines: [
          { variantId: v.variantId, quantity: "1", unitCost: "1" },
          { variantId: v.variantId, quantity: "2", unitCost: "1" },
        ],
      }),
      "ValidationError",
    );
  });

  it("la clave de idempotencia evita duplicar un movimiento", async () => {
    const v = await createVariant(org.owner);
    const key = randomUUID();
    const input = { type: "receipt" as const, locationId: org.locationId, reason: "Doble clic", idempotencyKey: key, lines: [{ variantId: v.variantId, quantity: "1", unitCost: "10" }] };
    const first = await postManualDocument(org.owner, input);
    const second = await postManualDocument(org.owner, input);
    expect(second.documentId).toBe(first.documentId);
    expect(second.duplicate).toBe(true);
    expect((await qtyOf(org, v.productId)).quantity).toBe("1.0000");
  });

  it("alertas de bajo stock y reconciliación sin diferencias", async () => {
    const v = await createVariant(org.owner, { threshold: "5" });
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "3", unitCost: "10" }] });
    const low = await lowStock(org.owner);
    expect(low.map((l) => l.variantId)).toContain(v.variantId);
    const result = await reconcile(org.owner);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);
  });

  it("los permisos se verifican en el servidor", async () => {
    const v = await createVariant(org.owner);
    const staff = await memberCtx(org, "staff");
    await expectReject(
      postManualDocument(staff, { type: "receipt", locationId: org.locationId, reason: "Intento", lines: [{ variantId: v.variantId, quantity: "1", unitCost: "1" }] }),
      "ForbiddenError",
    );
  });
});
