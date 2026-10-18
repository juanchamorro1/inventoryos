import { beforeAll, describe, expect, it } from "vitest";
import { getProduct } from "@/server/modules/catalog/service";
import { postManualDocument, reconcile } from "@/server/modules/inventory/service";
import {
  cancelOrClosePurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  getPurchaseOrder,
  issuePurchaseOrder,
  receivePurchaseOrder,
  reverseGoodsReceipt,
  updatePurchaseOrder,
} from "@/server/modules/purchasing/service";
import { createOrg, createVariant, expectReject, memberCtx, type OrgFixture } from "./helpers";

describe("compras y recepciones", () => {
  let org: OrgFixture;
  let supplierId: string;

  beforeAll(async () => {
    org = await createOrg("Compras SA");
    supplierId = (await createSupplier(org.owner, { name: "Distribuidora Andina", taxId: "900123456-1", email: "ventas@andina.test" }))!;
  });

  async function newOrder(lines: { variantId: string; quantity: string; unitCost: string }[]) {
    const id = await createPurchaseOrder(org.owner, { supplierId, warehouseId: org.warehouseId, lines });
    await issuePurchaseOrder(org.owner, id);
    return id;
  }

  it("recepción parcial y luego completa actualiza existencias, costos y estado", async () => {
    const a = await createVariant(org.owner);
    const b = await createVariant(org.owner);
    const poId = await newOrder([
      { variantId: a.variantId, quantity: "10", unitCost: "1000" },
      { variantId: b.variantId, quantity: "4", unitCost: "500" },
    ]);
    let po = await getPurchaseOrder(org.owner, poId);
    const lineA = po.lines.find((l) => l.variantId === a.variantId)!;
    const lineB = po.lines.find((l) => l.variantId === b.variantId)!;

    const r1 = await receivePurchaseOrder(org.owner, poId, { locationId: org.locationId, lines: [{ lineId: lineA.id, quantity: "6" }] });
    expect(r1.status).toBe("partially_received");
    po = await getPurchaseOrder(org.owner, poId);
    expect(po.status).toBe("partially_received");
    expect((await getProduct(org.owner, a.productId)).variants[0]).toMatchObject({ quantity: "6.0000", value: "6000.0000" });

    await expectReject(receivePurchaseOrder(org.owner, poId, { locationId: org.locationId, lines: [{ lineId: lineA.id, quantity: "5" }] }), "ValidationError");

    const r2 = await receivePurchaseOrder(org.owner, poId, {
      locationId: org.locationId,
      lines: [
        { lineId: lineA.id, quantity: "4" },
        { lineId: lineB.id, quantity: "4" },
      ],
    });
    expect(r2.status).toBe("received");
    expect((await getProduct(org.owner, a.productId)).variants[0]!.quantity).toBe("10.0000");
    await expectReject(receivePurchaseOrder(org.owner, poId, { locationId: org.locationId, lines: [{ lineId: lineB.id, quantity: "1" }] }), "ConflictError");
    expect((await reconcile(org.owner)).issues).toEqual([]);
  });

  it("solo se editan borradores; no se recibe un borrador", async () => {
    const a = await createVariant(org.owner);
    const id = await createPurchaseOrder(org.owner, { supplierId, warehouseId: org.warehouseId, lines: [{ variantId: a.variantId, quantity: "1", unitCost: "10" }] });
    await updatePurchaseOrder(org.owner, id, { supplierId, warehouseId: org.warehouseId, lines: [{ variantId: a.variantId, quantity: "3", unitCost: "12" }] });
    const po = await getPurchaseOrder(org.owner, id);
    expect(po.lines[0]).toMatchObject({ quantityOrdered: "3.0000", unitCost: "12.000000" });
    await expectReject(receivePurchaseOrder(org.owner, id, { locationId: org.locationId, lines: [{ lineId: po.lines[0]!.id, quantity: "1" }] }), "ConflictError");
    await issuePurchaseOrder(org.owner, id);
    await expectReject(updatePurchaseOrder(org.owner, id, { supplierId, warehouseId: org.warehouseId, lines: [{ variantId: a.variantId, quantity: "9", unitCost: "1" }] }), "ConflictError");
  });

  it("anular una recepción revierte stock y cantidades recibidas", async () => {
    const a = await createVariant(org.owner);
    const poId = await newOrder([{ variantId: a.variantId, quantity: "5", unitCost: "300" }]);
    const po = await getPurchaseOrder(org.owner, poId);
    const rec = await receivePurchaseOrder(org.owner, poId, { locationId: org.locationId, lines: [{ lineId: po.lines[0]!.id, quantity: "5" }] });
    await reverseGoodsReceipt(org.owner, rec.receiptId!, "Mercancía devuelta al proveedor");
    const after = await getPurchaseOrder(org.owner, poId);
    expect(after.status).toBe("ordered");
    expect(after.lines[0]!.quantityReceived).toBe("0.0000");
    expect((await getProduct(org.owner, a.productId)).variants[0]!.quantity).toBe("0.0000");
    await expectReject(reverseGoodsReceipt(org.owner, rec.receiptId!, "De nuevo"), "ConflictError");
  });

  it("no se anula una recepción si las unidades ya salieron", async () => {
    const a = await createVariant(org.owner);
    const poId = await newOrder([{ variantId: a.variantId, quantity: "2", unitCost: "300" }]);
    const po = await getPurchaseOrder(org.owner, poId);
    const rec = await receivePurchaseOrder(org.owner, poId, { locationId: org.locationId, lines: [{ lineId: po.lines[0]!.id, quantity: "2" }] });
    await postManualDocument(org.owner, { type: "issue", locationId: org.locationId, reason: "Venta mostrador", lines: [{ variantId: a.variantId, quantity: "1" }] });
    await expectReject(reverseGoodsReceipt(org.owner, rec.receiptId!, "Error"), "InsufficientStockError");
  });

  it("cancelar sin recepciones y cerrar con recepción parcial", async () => {
    const a = await createVariant(org.owner);
    const p1 = await newOrder([{ variantId: a.variantId, quantity: "2", unitCost: "1" }]);
    expect(await cancelOrClosePurchaseOrder(org.owner, p1, "Proveedor sin stock")).toBe("cancelled");
    const p2 = await newOrder([{ variantId: a.variantId, quantity: "2", unitCost: "1" }]);
    const po = await getPurchaseOrder(org.owner, p2);
    await receivePurchaseOrder(org.owner, p2, { locationId: org.locationId, lines: [{ lineId: po.lines[0]!.id, quantity: "1" }] });
    expect(await cancelOrClosePurchaseOrder(org.owner, p2, "Saldo no llegará")).toBe("closed");
  });

  it("el personal puede recibir pero no crear órdenes", async () => {
    const a = await createVariant(org.owner);
    const staff = await memberCtx(org, "staff");
    await expectReject(createPurchaseOrder(staff, { supplierId, warehouseId: org.warehouseId, lines: [{ variantId: a.variantId, quantity: "1", unitCost: "1" }] }), "ForbiddenError");
    const poId = await newOrder([{ variantId: a.variantId, quantity: "1", unitCost: "1" }]);
    const po = await getPurchaseOrder(staff, poId);
    const r = await receivePurchaseOrder(staff, poId, { locationId: org.locationId, lines: [{ lineId: po.lines[0]!.id, quantity: "1" }] });
    expect(r.status).toBe("received");
  });
});
