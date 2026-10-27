import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { productVariants } from "@/server/db/schema";
import { withTenantTx } from "@/server/db/tx";
import { createProductWithVariants, listProducts, listTaxRates } from "@/server/modules/catalog/service";
import { listPriceHistory, setRetailPriceFromScreen } from "@/server/modules/pricing/service";
import { D } from "@/server/platform/decimal";
import type { TenantContext } from "@/server/platform/context";
import { createOrg, expectReject, memberCtx } from "./helpers";

async function variantOf(ctx: TenantContext, id: string) {
  const [v] = await withTenantTx(ctx, (tx) => tx.select().from(productVariants).where(eq(productVariants.id, id)));
  return v!;
}

async function product(ctx: TenantContext, name = "Light Cleansing Oil") {
  // Impuesto predeterminado de la empresa: IVA 19 %.
  const iva = (await listTaxRates(ctx)).find((t) => t.isDefault)!;
  const { variantIds } = await createProductWithVariants(ctx, { name, taxRateId: iva.id, variants: [{ costAmount: "67320", salePrice: "67320", lowStockThreshold: "0" }] });
  return variantIds[0]!;
}

describe("cambiar precio desde la ficha", () => {
  it("con IVA incluido guarda el precio sin IVA para que el cliente pague exactamente lo escrito", async () => {
    const org = await createOrg("Precio rápido");
    const id = await product(org.owner);
    await setRetailPriceFromScreen(org.owner, { variantId: id, price: "80.200", includesTax: true });
    const v = await variantOf(org.owner, id);
    expect(v).toMatchObject({ salePrice: "67394.9580", retailPriceMode: "manual" });
    expect(new D(v.salePrice).times("1.19").toDecimalPlaces(2).toFixed(2)).toBe("80200.00");
    const h = await listPriceHistory(org.owner, { variantId: id });
    expect(h.rows[0]).toMatchObject({ oldPrice: "67320.0000", newPrice: "67394.9580", reason: "Cambio de precio" });

    // Sin IVA incluido se guarda tal cual.
    await setRetailPriceFromScreen(org.owner, { variantId: id, price: "70000", includesTax: false });
    expect((await variantOf(org.owner, id)).salePrice).toBe("70000.0000");

    // El listado expone la tarifa para mostrar el precio que paga el cliente.
    expect((await listProducts(org.owner, { search: "Light Cleansing" })).rows[0]!.taxRate).toBe("19.0000");
  });

  it("exige confirmación por debajo del costo, valida el valor y respeta permisos y empresas", async () => {
    const org = await createOrg("Precio rápido permisos");
    const id = await product(org.owner);
    await expectReject(setRetailPriceFromScreen(org.owner, { variantId: id, price: "50.000", includesTax: true }), /menor que su costo/);
    await setRetailPriceFromScreen(org.owner, { variantId: id, price: "50.000", includesTax: true, acceptBelowCost: true });
    for (const bad of ["0", "-5", "abc", ""]) await expectReject(setRetailPriceFromScreen(org.owner, { variantId: id, price: bad }), "ValidationError");
    const staff = await memberCtx(org, "staff");
    await expectReject(setRetailPriceFromScreen(staff, { variantId: id, price: "90000" }), "ForbiddenError");
    const other = await createOrg("Otra empresa precio");
    await expectReject(setRetailPriceFromScreen(other.owner, { variantId: id, price: "90000", acceptBelowCost: true }), "NotFoundError");
  });
});
