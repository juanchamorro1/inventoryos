import { updateProductAction } from "@/app/actions/catalog";
import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
import { trimDecimal as num } from "@/lib/decimal-text";
import { load, requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getProduct, listBrands, listCategories, listTaxRates } from "@/server/modules/catalog/service";
import { getOrganization } from "@/server/modules/organizations/service";
import { getPricingHints } from "@/server/modules/pricing/service";
import { profileOf } from "@/server/platform/business-types";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Editar producto" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "catalog.write");
  const [p, categories, brands, taxRates, org, pricing, suppliers] = await Promise.all([
    load(getProduct(ctx, id)),
    listCategories(ctx),
    listBrands(ctx),
    listTaxRates(ctx),
    getOrganization(ctx),
    getPricingHints(ctx),
    can(ctx, "purchasing.read") ? listSuppliers(ctx, { pageSize: 100 }).then((r) => r.rows) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={`Editar: ${p.name}`} description="Para cambiar la cantidad en existencia usa Inventario › Ajustar." back={{ href: `/products/${p.id}`, label: p.name }} />
      <ProductForm
        action={updateProductAction}
        submitLabel="Guardar cambios"
        categories={categories}
        brands={brands}
        taxRates={taxRates}
        currency={org.currency}
        canSetStock={false}
        pricing={pricing}
        profile={profileOf(org.businessType)}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        initial={{
          productId: p.id,
          name: p.name,
          description: p.description ?? "",
          categoryName: p.categoryName ?? "",
          brandName: p.brandName ?? "",
          taxRateId: p.taxRateId ?? "",
          supplierName: p.supplierName ?? "",
          retailMargin: p.retailMargin ? num(p.retailMargin) : "",
          wholesaleMargin: p.wholesaleMargin ? num(p.wholesaleMargin) : "",
          unit: p.unit,
          attributes: p.attributes,
          options: p.options,
          variants: p.variants
            .filter((v) => v.status === "active")
            .map((v) => ({
              id: v.id,
              sku: v.sku,
              barcode: v.barcode ?? "",
              name: v.name,
              optionValues: v.optionValues,
              costPrice: num(v.costAmount),
              costCurrency: v.costCurrency,
              extraCostCop: Number(v.extraCostCop) ? num(v.extraCostCop) : "",
              referenceCode: v.referenceCode ?? "",
              // Solo los precios MANUALES se muestran en el campo; vacío = automático.
              salePrice: v.retailPriceMode === "manual" || !pricing.retailAutoEnabled ? num(v.salePrice) : "",
              wholesalePrice: v.wholesalePriceMode === "manual" && v.wholesalePrice ? num(v.wholesalePrice) : "",
              wholesaleMinQty: v.wholesaleMinQty ? num(v.wholesaleMinQty) : "",
              suggestedRetail: v.suggestedRetailPrice,
              suggestedWholesale: v.suggestedWholesalePrice,
              lowStockThreshold: num(v.lowStockThreshold),
            })),
        }}
      />
    </>
  );
}
