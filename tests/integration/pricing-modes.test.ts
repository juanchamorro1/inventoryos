import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { productVariants } from "@/server/db/schema";
import { withTenantTx } from "@/server/db/tx";
import { importProductRows } from "@/server/modules/catalog/csv";
import { createProductWithVariants, listProducts } from "@/server/modules/catalog/service";
import { listCatalogProducts } from "@/server/modules/integrations/public-catalog";
import { approvePriceChanges, getPricingOverview, listPendingChanges, setManualRate, setPricingModes, updatePricingSettings } from "@/server/modules/pricing/service";
import type { TenantContext } from "@/server/platform/context";
import { createOrg, expectReject, memberCtx } from "./helpers";

const SETTINGS = { fxAdjustmentCop: "100", retailMargin: "30", wholesaleMargin: "20", extraCostPercent: "0", roundingStep: "100", roundingMode: "up", applyPolicy: "approval", rateMode: "manual", maxRateAgeHours: "48" };

async function variantOf(ctx: TenantContext, id: string) {
  const [v] = await withTenantTx(ctx, (tx) => tx.select().from(productVariants).where(eq(productVariants.id, id)));
  return v!;
}

async function setup() {
  const org = await createOrg("Interruptores");
  await updatePricingSettings(org.owner, SETTINGS);
  await setManualRate(org.owner, { rate: "4000", reason: "Prueba" });
  const { variantIds } = await createProductWithVariants(org.owner, { name: `Auto ${randomUUID().slice(0, 6)}`, variants: [{ costAmount: "100", costCurrency: "USD", lowStockThreshold: "0" }] });
  return { org, id: variantIds[0]! };
}

describe("sistemas de precios: encender y apagar", () => {
  it("por defecto ambos están encendidos", async () => {
    const org = await createOrg("Por defecto");
    expect((await getPricingOverview(org.owner)).settings).toMatchObject({ retailAutoEnabled: true, wholesaleEnabled: true });
  });

  it("con los precios automáticos apagados no hay pendientes, nada se publica y el precio escrito es obligatorio", async () => {
    const { org, id } = await setup();
    expect((await variantOf(org.owner, id)).salePrice).toBe("585800.0000");
    await setPricingModes(org.owner, { retailAutoEnabled: false, wholesaleEnabled: true });
    await setManualRate(org.owner, { rate: "4400", reason: "Sube" });
    const v = await variantOf(org.owner, id);
    // No cambia el precio publicado; el sugerido se sigue guardando como referencia.
    expect(v).toMatchObject({ salePrice: "585800.0000", suggestedRetailPrice: "642857.1429" });
    const pending = await listPendingChanges(org.owner);
    expect(pending.rows.every((r) => !r.retailChanges)).toBe(true);
    await approvePriceChanges(org.owner, { variantIds: "all" });
    expect((await variantOf(org.owner, id)).salePrice).toBe("585800.0000");

    await expectReject(createProductWithVariants(org.owner, { name: "Sin precio", variants: [{ costAmount: "1000", lowStockThreshold: "0" }] }), /los precios automáticos están apagados/);
    const { variantIds } = await createProductWithVariants(org.owner, { name: "Con precio", variants: [{ costAmount: "1000", salePrice: "1500", lowStockThreshold: "0" }] });
    expect(await variantOf(org.owner, variantIds[0]!)).toMatchObject({ salePrice: "1500.0000", retailPriceMode: "manual" });

    const imported = await importProductRows(org.owner, [{ producto: "Sin precio importado", sku: "IMP-NP", costo: "100" }]);
    expect(imported.applied).toBe(false);
    expect(imported.errors[0]!.message).toMatch(/precio: obligatorio/);
    expect((await importProductRows(org.owner, [{ producto: "Con precio importado", sku: "IMP-P", costo: "100", precio: "200" }])).applied).toBe(true);
  });

  it("con el mayorista apagado no se calcula, no queda pendiente, no se aprueba ni sale en la API", async () => {
    const { org, id } = await setup();
    expect((await variantOf(org.owner, id)).wholesalePrice).toBe("512500.0000");
    await setPricingModes(org.owner, { retailAutoEnabled: true, wholesaleEnabled: false });
    await setManualRate(org.owner, { rate: "4400", reason: "Sube" });
    const pending = await listPendingChanges(org.owner);
    expect(pending.rows.find((r) => r.variantId === id)).toMatchObject({ retailChanges: true, wholesaleChanges: false });
    await approvePriceChanges(org.owner, { variantIds: "all" });
    // Se publicó el minorista; el mayorista quedó igual (los datos se conservan).
    expect(await variantOf(org.owner, id)).toMatchObject({ salePrice: "642900.0000", wholesalePrice: "512500.0000" });

    const api = await listCatalogProducts(org.owner, {});
    expect(api.data.flatMap((p) => p.variants).every((v) => v.prices.wholesale === null)).toBe(true);

    // Al volver a encenderlo reaparece y se recalcula (queda pendiente según la política).
    await setPricingModes(org.owner, { retailAutoEnabled: true, wholesaleEnabled: true });
    expect((await listPendingChanges(org.owner)).rows.find((r) => r.variantId === id)).toMatchObject({ wholesaleChanges: true });
    expect((await listCatalogProducts(org.owner, {})).data.flatMap((p) => p.variants).some((v) => v.prices.wholesale !== null)).toBe(true);
  });

  it("con ambos apagados no hay ningún pendiente y el filtro del catálogo queda vacío", async () => {
    const { org } = await setup();
    await setManualRate(org.owner, { rate: "4400", reason: "Sube" });
    expect((await listPendingChanges(org.owner)).total).toBe(1);
    await setPricingModes(org.owner, { retailAutoEnabled: false, wholesaleEnabled: false });
    expect((await listPendingChanges(org.owner)).total).toBe(0);
    expect((await getPricingOverview(org.owner)).counts.pending).toBe(0);
    expect((await listProducts(org.owner, { pricing: "pending" })).total).toBe(0);
  });

  it("solo pricing.manage puede cambiarlos, y cada empresa tiene los suyos", async () => {
    const { org } = await setup();
    const staff = await memberCtx(org, "staff");
    await expectReject(setPricingModes(staff, { retailAutoEnabled: false, wholesaleEnabled: false }), "ForbiddenError");
    await setPricingModes(org.owner, { retailAutoEnabled: false, wholesaleEnabled: false });
    const other = await createOrg("Otra");
    expect((await getPricingOverview(other.owner)).settings).toMatchObject({ retailAutoEnabled: true, wholesaleEnabled: true });
  });
});
