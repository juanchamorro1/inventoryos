import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { products, suppliers } from "@/server/db/schema";
import { withTenantTx } from "@/server/db/tx";
import { authenticateApiKey, createApiKey } from "@/server/modules/api-keys/service";
import { buildTenantContext } from "@/server/modules/auth/service";
import { getProduct, listProducts, searchVariants, updateProduct } from "@/server/modules/catalog/service";
import { searchCatalog, getBySku } from "@/server/modules/integrations/catalog-api";
import { getDocument, postManualDocument } from "@/server/modules/inventory/service";
import { createPurchaseOrder, createSupplier, getSupplier } from "@/server/modules/purchasing/service";
import { createSale } from "@/server/modules/sales/service";
import { createOrg, createVariant, expectPgError, expectReject, type OrgFixture } from "./helpers";

describe("aislamiento entre empresas", () => {
  let a: OrgFixture;
  let b: OrgFixture;
  let bVariant: { productId: string; variantId: string; sku: string };
  let bSupplier: string;
  let bDocument: string;

  beforeAll(async () => {
    a = await createOrg("Empresa A");
    b = await createOrg("Empresa B");
    await createVariant(a.owner, { sku: "IPHONE-15" });
    bVariant = await createVariant(b.owner, { sku: "IPHONE-15" }); // mismo SKU en otra empresa: permitido
    bSupplier = (await createSupplier(b.owner, { name: "Proveedor de B" }))!;
    const doc = await postManualDocument(b.owner, {
      type: "receipt",
      locationId: b.locationId,
      reason: "Carga inicial",
      lines: [{ variantId: bVariant.variantId, quantity: "5", unitCost: "1000" }],
    });
    bDocument = doc.documentId;
  });

  it("A no puede leer productos, proveedores ni documentos de B (404)", async () => {
    await expectReject(getProduct(a.owner, bVariant.productId), "NotFoundError");
    await expectReject(getSupplier(a.owner, bSupplier), "NotFoundError");
    await expectReject(getDocument(a.owner, bDocument), "NotFoundError");
    const list = await listProducts(a.owner);
    expect(list.rows.every((r) => r.id !== bVariant.productId)).toBe(true);
    const search = await searchVariants(a.owner, "IPHONE");
    expect(search.map((s) => s.variantId)).not.toContain(bVariant.variantId);
  });

  it("A no puede modificar datos de B", async () => {
    await expectReject(
      updateProduct(a.owner, bVariant.productId, { name: "Hackeado", variants: [{ sku: "X", costPrice: "1", salePrice: "1", lowStockThreshold: "0" }] }),
      "NotFoundError",
    );
    const p = await getProduct(b.owner, bVariant.productId);
    expect(p.name).not.toBe("Hackeado");
  });

  it("A no puede mover stock ni vender usando IDs de B", async () => {
    await expectReject(
      postManualDocument(a.owner, { type: "issue", locationId: b.locationId, reason: "Intento", lines: [{ variantId: bVariant.variantId, quantity: "1" }] }),
      "NotFoundError",
    );
    await expectReject(
      createSale(a.owner, { locationId: a.locationId, paymentMethod: "cash", lines: [{ variantId: bVariant.variantId, quantity: "1" }] }),
      "NotFoundError",
    );
    await expectReject(
      createPurchaseOrder(a.owner, { supplierId: bSupplier, warehouseId: a.warehouseId, lines: [{ variantId: bVariant.variantId, quantity: "1", unitCost: "1" }] }),
      "ValidationError",
    );
    const p = await getProduct(b.owner, bVariant.productId);
    expect(p.variants[0]!.quantity).toBe("5.0000");
  });

  it("la base de datos rechaza filas con organization_id ajeno (RLS WITH CHECK)", async () => {
    await expectPgError(
      withTenantTx(a.owner, (tx) => tx.insert(products).values({ organizationId: b.organizationId, name: "Infiltrado" })),
      "42501",
    );
  });

  it("las claves foráneas compuestas impiden referencias cruzadas aun con SQL directo", async () => {
    await expectPgError(
      withTenantTx(a.owner, (tx) =>
        tx.execute(sql`insert into purchase_orders (organization_id, number, supplier_id, warehouse_id, created_by)
                       values (${a.organizationId}, 'OC-X', ${bSupplier}, ${a.warehouseId}, ${a.owner.userId})`),
      ),
      "23503",
    );
  });

  it("SQL directo con contexto de A no ve filas de B", async () => {
    const rows = await withTenantTx(a.owner, (tx) => tx.select().from(suppliers));
    expect(rows.some((s) => s.id === bSupplier)).toBe(false);
  });

  it("un usuario de A no obtiene contexto en B", async () => {
    await expectReject(buildTenantContext(a.owner.userId, b.organizationId), "NotFoundError");
  });

  it("una clave API de A solo ve el catálogo de A", async () => {
    const { key } = await createApiKey(a.owner, { name: "WhatsApp", scopes: ["catalog:read", "inventory:read"] });
    const apiCtx = await authenticateApiKey(`Bearer ${key}`);
    expect(apiCtx.organizationId).toBe(a.organizationId);
    const result = await searchCatalog(apiCtx, "IPHONE", 1, 20);
    expect(result.data).toHaveLength(1);
    const item = await getBySku(apiCtx, "IPHONE-15");
    expect(item.availability?.total).toBe("0");
    await expectReject(authenticateApiKey("Bearer ios_AAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"), "UnauthenticatedError");
  });
});
