import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { sales } from "@/server/db/schema";
import { withTenantTx } from "@/server/db/tx";
import { getProduct } from "@/server/modules/catalog/service";
import { postManualDocument, reconcile, stockByVariant } from "@/server/modules/inventory/service";
import { createPurchaseOrder, createSupplier, getPurchaseOrder, issuePurchaseOrder, receivePurchaseOrder } from "@/server/modules/purchasing/service";
import { createSale } from "@/server/modules/sales/service";
import { createWarehouse, getWarehouse } from "@/server/modules/warehouses/service";
import { createOrg, createVariant, type OrgFixture } from "./helpers";

// Pruebas reales contra PostgreSQL: cada operación usa su propia conexión del pool (DB_POOL_MAX=40),
// así que las transacciones compiten de verdad por las mismas filas.

describe("concurrencia", () => {
  let org: OrgFixture;

  beforeAll(async () => {
    org = await createOrg("Concurrencia SA");
  });

  it("30 ventas simultáneas sobre 10 unidades: exactamente 10 se confirman", async () => {
    const v = await createVariant(org.owner);
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "10", unitCost: "100" }] });
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, () =>
        createSale(org.owner, { locationId: org.locationId, paymentMethod: "cash", lines: [{ variantId: v.variantId, quantity: "1" }] }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as Error).name);
    expect(ok).toBe(10);
    expect(new Set(failures)).toEqual(new Set(["InsufficientStockError"]));
    const p = await getProduct(org.owner, v.productId);
    expect(p.variants[0]).toMatchObject({ quantity: "0.0000", value: "0.0000" });
  });

  it("transferencias cruzadas simultáneas no producen deadlocks visibles ni pierden unidades", async () => {
    const wh = await createWarehouse(org.owner, { code: "B2", name: "Bodega 2" });
    const other = (await getWarehouse(org.owner, wh!)).locations[0]!.id;
    const v = await createVariant(org.owner);
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "50", unitCost: "10" }] });
    await postManualDocument(org.owner, { type: "receipt", locationId: other, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "50", unitCost: "30" }] });
    const ops = Array.from({ length: 40 }, (_, i) =>
      postManualDocument(org.owner, {
        type: "transfer",
        fromLocationId: i % 2 ? org.locationId : other,
        toLocationId: i % 2 ? other : org.locationId,
        reason: "Rebalanceo",
        lines: [{ variantId: v.variantId, quantity: "1" }],
      }),
    );
    const results = await Promise.allSettled(ops);
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => String(r.reason));
    expect(errors).toEqual([]);
    const stock = await stockByVariant(org.owner, v.variantId);
    const totalQty = stock.byWarehouse.reduce((a, w) => a + Number(w.quantity), 0);
    const totalValue = stock.byWarehouse.reduce((a, w) => a + Number(w.totalValue), 0);
    expect(totalQty).toBe(100);
    expect(totalValue).toBeCloseTo(2000, 2); // el valor total se conserva (± redondeo de 4 decimales)
    expect((await reconcile(org.owner)).issues).toEqual([]);
  });

  it("recepciones simultáneas de la misma línea nunca superan lo pedido", async () => {
    const v = await createVariant(org.owner);
    const supplierId = await createSupplier(org.owner, { name: `Proveedor ${randomUUID().slice(0, 6)}` });
    const poId = await createPurchaseOrder(org.owner, { supplierId: supplierId!, warehouseId: org.warehouseId, lines: [{ variantId: v.variantId, quantity: "5", unitCost: "10" }] });
    await issuePurchaseOrder(org.owner, poId);
    const lineId = (await getPurchaseOrder(org.owner, poId)).lines[0]!.id;
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => receivePurchaseOrder(org.owner, poId, { locationId: org.locationId, lines: [{ lineId, quantity: "1" }] })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const po = await getPurchaseOrder(org.owner, poId);
    expect(po.lines[0]!.quantityReceived).toBe("5.0000");
    expect(po.status).toBe("received");
    expect((await getProduct(org.owner, v.productId)).variants[0]!.quantity).toBe("5.0000");
  });

  it("20 solicitudes simultáneas con la misma clave de idempotencia crean una sola venta", async () => {
    const v = await createVariant(org.owner);
    await postManualDocument(org.owner, { type: "receipt", locationId: org.locationId, reason: "Carga", lines: [{ variantId: v.variantId, quantity: "100", unitCost: "1" }] });
    const key = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        createSale(org.owner, { idempotencyKey: key, locationId: org.locationId, paymentMethod: "cash", lines: [{ variantId: v.variantId, quantity: "1" }] }),
      ),
    );
    const values = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.saleId] : []));
    expect(values).toHaveLength(20);
    expect(new Set(values).size).toBe(1);
    const [n] = await withTenantTx(org.owner, (tx) => tx.select({ n: count() }).from(sales).where(eq(sales.id, values[0]!)));
    expect(n!.n).toBe(1);
    expect((await getProduct(org.owner, v.productId)).variants[0]!.quantity).toBe("99.0000");
  });
});
