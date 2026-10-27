import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { productVariants } from "@/server/db/schema";
import { withTenantTx } from "@/server/db/tx";
import { createProductWithVariants, listTaxRates, updateProduct } from "@/server/modules/catalog/service";
import { getPricingHints, getPricingOverview, setPricingModes, setRetailPriceFromScreen } from "@/server/modules/pricing/service";
import { D } from "@/server/platform/decimal";
import type { TenantContext } from "@/server/platform/context";
import { createOrg, expectReject, memberCtx } from "./helpers";

async function variantOf(ctx: TenantContext, id: string) {
  const [v] = await withTenantTx(ctx, (tx) => tx.select().from(productVariants).where(eq(productVariants.id, id)));
  return v!;
}

describe("redondear el precio que paga el cliente", () => {
  it("apagado por defecto; encendido sube lo que paga el cliente (con IVA) al múltiplo elegido", async () => {
    const org = await createOrg("Redondeo");
    expect((await getPricingOverview(org.owner)).settings).toMatchObject({ roundClientPrice: false, clientPriceStep: "100" });
    const iva = (await listTaxRates(org.owner)).find((t) => t.isDefault)!;
    const { variantIds } = await createProductWithVariants(org.owner, { name: "Light Cleansing Oil", taxRateId: iva.id, variants: [{ costAmount: "67320", salePrice: "67320", lowStockThreshold: "0" }] });
    const id = variantIds[0]!;

    // Apagado: se guarda exactamente (67.320 + 19 % = 80.110,80).
    await setRetailPriceFromScreen(org.owner, { variantId: id, price: "67320", includesTax: false });
    expect((await variantOf(org.owner, id)).salePrice).toBe("67320.0000");

    await setPricingModes(org.owner, { retailAutoEnabled: true, wholesaleEnabled: true, roundClientPrice: true, clientPriceStep: "100" });
    expect(await getPricingHints(org.owner)).toMatchObject({ roundClientPrice: true, clientPriceStep: "100" });

    // Encendido: 80.110,80 → 80.200 que paga el cliente; se guarda el precio sin IVA equivalente.
    await setRetailPriceFromScreen(org.owner, { variantId: id, price: "67320", includesTax: false });
    const v = await variantOf(org.owner, id);
    expect(v.salePrice).toBe("67394.9580");
    expect(new D(v.salePrice).times("1.19").toDecimalPlaces(2).toFixed(2)).toBe("80200.00");
    await setRetailPriceFromScreen(org.owner, { variantId: id, price: "80.110,80", includesTax: true });
    expect((await variantOf(org.owner, id)).salePrice).toBe("67394.9580");
    // Volver a guardar el precio ya redondeado no lo sube otro escalón (67.394,958 × 1,19 = 80.200,00002).
    await setRetailPriceFromScreen(org.owner, { variantId: id, price: "67394.958", includesTax: false });
    expect((await variantOf(org.owner, id)).salePrice).toBe("67394.9580");

    // Múltiplo de 1.000: 80.110,80 → 81.000.
    await setPricingModes(org.owner, { retailAutoEnabled: true, wholesaleEnabled: true, roundClientPrice: true, clientPriceStep: "1000" });
    await setRetailPriceFromScreen(org.owner, { variantId: id, price: "80.110,80", includesTax: true });
    expect(new D((await variantOf(org.owner, id)).salePrice).times("1.19").toDecimalPlaces(2).toFixed(2)).toBe("81000.00");
  });

  it("valida el múltiplo, exige pricing.manage y cada empresa tiene el suyo", async () => {
    const org = await createOrg("Redondeo permisos");
    await expectReject(setPricingModes(org.owner, { retailAutoEnabled: true, wholesaleEnabled: true, roundClientPrice: true, clientPriceStep: "0" }), "ValidationError");
    const staff = await memberCtx(org, "staff");
    await expectReject(setPricingModes(staff, { retailAutoEnabled: true, wholesaleEnabled: true, roundClientPrice: true }), "ForbiddenError");
    await setPricingModes(org.owner, { retailAutoEnabled: true, wholesaleEnabled: true, roundClientPrice: true, clientPriceStep: "500" });
    const other = await createOrg("Redondeo otra");
    expect((await getPricingOverview(other.owner)).settings).toMatchObject({ roundClientPrice: false });
  });
});

describe("mayorista con valor agregado", () => {
  it("mayorista (sin IVA) = costo + valor en % o en plata; el servidor ignora el valor que manda el navegador", async () => {
    const org = await createOrg("Mayorista valor agregado");
    const { productId, variantIds } = await createProductWithVariants(org.owner, {
      name: "Mascarilla",
      variants: [{ costAmount: "10000", salePrice: "15000", wholesalePrice: "1", wholesaleMarkupType: "percent", wholesaleMarkupValue: "19", lowStockThreshold: "0" }],
    });
    const id = variantIds[0]!;
    expect(await variantOf(org.owner, id)).toMatchObject({ wholesalePrice: "11900.0000", wholesaleMarkupType: "percent", wholesaleMarkupValue: "19.0000", wholesalePriceMode: "manual" });

    await updateProduct(org.owner, productId, {
      name: "Mascarilla",
      variants: [{ id, costAmount: "12000", salePrice: "15000", wholesaleMarkupType: "amount", wholesaleMarkupValue: "2.500", lowStockThreshold: "0" }],
    });
    expect(await variantOf(org.owner, id)).toMatchObject({ wholesalePrice: "14500.0000", wholesaleMarkupType: "amount", wholesaleMarkupValue: "2500.0000" });

    // Sin valor agregado se vuelve a escribir el mayorista a mano.
    await updateProduct(org.owner, productId, { name: "Mascarilla", variants: [{ id, costAmount: "12000", salePrice: "15000", wholesalePrice: "13000", lowStockThreshold: "0" }] });
    expect(await variantOf(org.owner, id)).toMatchObject({ wholesalePrice: "13000.0000", wholesaleMarkupType: null, wholesaleMarkupValue: null });

    // Otra empresa no ve la presentación.
    const other = await createOrg("Mayorista otra");
    expect(await withTenantTx(other.owner, (tx) => tx.select().from(productVariants).where(eq(productVariants.id, id)))).toHaveLength(0);
  });

  it("rechaza valores agregados inválidos", async () => {
    const org = await createOrg("Mayorista inválido");
    for (const bad of ["-5", "abc"]) {
      await expectReject(createProductWithVariants(org.owner, { name: `Malo ${bad}`, variants: [{ costAmount: "1000", salePrice: "2000", wholesaleMarkupValue: bad, lowStockThreshold: "0" }] }), "ValidationError");
    }
  });
});
