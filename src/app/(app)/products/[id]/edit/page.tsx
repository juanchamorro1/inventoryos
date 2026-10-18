import { updateProductAction } from "@/app/actions/catalog";
import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
import { trimDecimal as num } from "@/lib/decimal-text";
import { load, requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getProduct, listBrands, listCategories, listTaxRates } from "@/server/modules/catalog/service";
import { getOrganization } from "@/server/modules/organizations/service";

export const metadata = { title: "Editar producto" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "catalog.write");
  const [p, categories, brands, taxRates, org] = await Promise.all([load(getProduct(ctx, id)), listCategories(ctx), listBrands(ctx), listTaxRates(ctx), getOrganization(ctx)]);
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
        initial={{
          productId: p.id,
          name: p.name,
          description: p.description ?? "",
          categoryName: p.categoryName ?? "",
          brandName: p.brandName ?? "",
          taxRateId: p.taxRateId ?? "",
          unit: p.unit,
          imagePath: p.imagePath,
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
              costPrice: num(v.costPrice),
              salePrice: num(v.salePrice),
              lowStockThreshold: num(v.lowStockThreshold),
            })),
        }}
      />
    </>
  );
}
