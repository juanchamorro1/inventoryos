import { createSupplierAction } from "@/app/actions/purchasing";
import { ActionForm, SubmitButton } from "@/components/form";
import { SupplierFields } from "@/components/supplier-fields";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";

export const metadata = { title: "Nuevo proveedor" };

export default async function NewSupplierPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "purchasing.write");
  return (
    <>
      <PageHeader title="Nuevo proveedor" back={{ href: "/purchasing/suppliers", label: "Proveedores" }} />
      <Card>
        <ActionForm action={createSupplierAction}>
          <SupplierFields />
          <SubmitButton>Crear proveedor</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
