import { beforeAll, describe, expect, it } from "vitest";
import { getProduct } from "@/server/modules/catalog/service";
import { postManualDocument, reconcile } from "@/server/modules/inventory/service";
import { cancelSale, createCustomer, createSale, getSale, returnSale } from "@/server/modules/sales/service";
import { createOrg, createVariant, expectReject, memberCtx, type OrgFixture } from "./helpers";

describe("ventas, devoluciones y anulaciones", () => {
  let org: OrgFixture;

  beforeAll(async () => {
    org = await createOrg("Ventas SA");
  });

  async function stocked(qty: string, cost: string, price = "1000") {
    const v = await createVariant(org.owner, { price });
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: qty, unitCost: cost }] });
    return v;
  }

  it("registra la venta con impuesto, costo y descuenta existencias", async () => {
    const v = await stocked("5", "600", "1000");
    const customerId = await createCustomer(org.owner, { name: "Laura Gómez", documentNumber: "1020304050" });
    const { saleId } = await createSale(org.owner, { customerId, locationId: org.locationId, paymentMethod: "card", lines: [{ variantId: v.variantId, quantity: "2" }] });
    const sale = await getSale(org.owner, saleId);
    // Impuesto por defecto: sin impuesto asignado al producto → 0 %
    expect(sale).toMatchObject({ subtotal: "2000.0000", taxTotal: "0.0000", total: "2000.0000", costTotal: "1200.0000", status: "confirmed" });
    expect(sale.lines[0]!.unitCost).toBe("600.000000");
    expect((await getProduct(org.owner, v.productId)).variants[0]!.quantity).toBe("3.0000");
  });

  it("no vende más de lo disponible", async () => {
    const v = await stocked("1", "10");
    await expectReject(createSale(org.owner, { locationId: org.locationId, paymentMethod: "cash", lines: [{ variantId: v.variantId, quantity: "2" }] }), "InsufficientStockError");
  });

  it("devolución parcial y total al costo original con reembolso proporcional", async () => {
    const v = await stocked("3", "100", "333.3333");
    const { saleId } = await createSale(org.owner, { locationId: org.locationId, paymentMethod: "cash", lines: [{ variantId: v.variantId, quantity: "3" }] });
    const sale = await getSale(org.owner, saleId);
    const lineId = sale.lines[0]!.id;
    await returnSale(org.owner, saleId, { reason: "Producto defectuoso", lines: [{ saleLineId: lineId, quantity: "1" }] });
    expect((await getSale(org.owner, saleId)).status).toBe("partially_returned");
    await expectReject(returnSale(org.owner, saleId, { reason: "Exceso", lines: [{ saleLineId: lineId, quantity: "3" }] }), "ValidationError");
    await returnSale(org.owner, saleId, { reason: "Cliente desistió", lines: [{ saleLineId: lineId, quantity: "2" }] });
    const done = await getSale(org.owner, saleId);
    expect(done.status).toBe("returned");
    const refunded = done.returns.reduce((a, r) => a + Number(r.refundTotal), 0);
    expect(refunded.toFixed(4)).toBe(Number(done.total).toFixed(4));
    expect((await getProduct(org.owner, v.productId)).variants[0]).toMatchObject({ quantity: "3.0000", value: "300.0000" });
    await expectReject(cancelSale(org.owner, saleId, "Ya devuelta"), "ConflictError");
  });

  it("anulación devuelve el stock y deja el historial intacto", async () => {
    const v = await stocked("2", "50");
    const { saleId } = await createSale(org.owner, { locationId: org.locationId, paymentMethod: "cash", lines: [{ variantId: v.variantId, quantity: "2" }] });
    await cancelSale(org.owner, saleId, "Error de digitación");
    const sale = await getSale(org.owner, saleId);
    expect(sale.status).toBe("cancelled");
    expect(sale.cancellationDocumentId).toBeTruthy();
    expect((await getProduct(org.owner, v.productId)).variants[0]).toMatchObject({ quantity: "2.0000", value: "100.0000" });
    await expectReject(cancelSale(org.owner, saleId, "Otra vez"), "ConflictError");
    await expectReject(returnSale(org.owner, saleId, { reason: "No aplica", lines: [{ saleLineId: sale.lines[0]!.id, quantity: "1" }] }), "ConflictError");
    expect((await reconcile(org.owner)).issues).toEqual([]);
  });

  it("el vendedor no puede cambiar precios, dar descuentos, anular ni devolver", async () => {
    const v = await stocked("5", "10", "100");
    const staff = await memberCtx(org, "staff");
    await expectReject(createSale(staff, { locationId: org.locationId, paymentMethod: "cash", lines: [{ variantId: v.variantId, quantity: "1", unitPrice: "1" }] }), "ForbiddenError");
    await expectReject(createSale(staff, { locationId: org.locationId, paymentMethod: "cash", lines: [{ variantId: v.variantId, quantity: "1", discount: "5" }] }), "ForbiddenError");
    const { saleId } = await createSale(staff, { locationId: org.locationId, paymentMethod: "cash", lines: [{ variantId: v.variantId, quantity: "1" }] });
    await expectReject(cancelSale(staff, saleId, "Intento"), "ForbiddenError");
    const viewer = await memberCtx(org, "viewer");
    await expectReject(createSale(viewer, { locationId: org.locationId, paymentMethod: "cash", lines: [{ variantId: v.variantId, quantity: "1" }] }), "ForbiddenError");
  });

  it("valida descuentos y métodos de pago", async () => {
    const v = await stocked("5", "10", "100");
    await expectReject(createSale(org.owner, { locationId: org.locationId, paymentMethod: "cash", lines: [{ variantId: v.variantId, quantity: "1", discount: "101" }] }), "ValidationError");
    await expectReject(createSale(org.owner, { locationId: org.locationId, paymentMethod: "bitcoin", lines: [{ variantId: v.variantId, quantity: "1" }] }), "ValidationError");
  });
});
