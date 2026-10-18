import { createProductAction } from "@/app/actions/catalog";
import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { listBrands, listCategories, listTaxRates } from "@/server/modules/catalog/service";
import { getOrganization } from "@/server/modules/organizations/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "catalog.write");
  const [categories, brands, taxRates, org] = await Promise.all([listCategories(ctx), listBrands(ctx), listTaxRates(ctx), getOrganization(ctx)]);
  return (
    <>
      <PageHeader
        title="Agregar un producto"
        description="Solo el nombre y el precio son obligatorios. Lo demás puedes completarlo después."
        back={{ href: "/products", label: "Productos" }}
        help={
          <>
            <p>Si vendes el mismo producto en varios colores o capacidades, marca «varias presentaciones»: cada una tendrá su propio precio y cantidad.</p>
            <p>¿Tienes muchos productos? Usa «Importar desde Excel» en la lista de productos.</p>
          </>
        }
      />
      <ProductForm
        action={createProductAction}
        submitLabel="Guardar producto"
        categories={categories}
        brands={brands}
        taxRates={taxRates}
        currency={org.currency}
        canSetStock={can(ctx, "inventory.write")}
        initial={{ name: "", description: "", categoryName: "", brandName: "", taxRateId: "", unit: "unidad", attributes: {}, options: [], variants: [] }}
      />
    </>
  );
}
