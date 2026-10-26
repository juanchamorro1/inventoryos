import { createProductAction } from "@/app/actions/catalog";
import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { listBrands, listCategories, listTaxRates } from "@/server/modules/catalog/service";
import { getOrganization } from "@/server/modules/organizations/service";
import { getPricingHints } from "@/server/modules/pricing/service";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "catalog.write");
  const [categories, brands, taxRates, org, pricing, suppliers] = await Promise.all([
    listCategories(ctx),
    listBrands(ctx),
    listTaxRates(ctx),
    getOrganization(ctx),
    getPricingHints(ctx),
    can(ctx, "purchasing.read") ? listSuppliers(ctx, { pageSize: 100 }).then((r) => r.rows) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        title="Agregar un producto"
        description="Solo el nombre es obligatorio. Escribe el costo y el precio se calcula solo, o fija el precio a mano."
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
        pricing={pricing}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        initial={{ name: "", description: "", categoryName: "", brandName: "", taxRateId: "", supplierName: "", retailMargin: "", wholesaleMargin: "", unit: "unidad", attributes: {}, options: [], variants: [] }}
      />
    </>
  );
}
