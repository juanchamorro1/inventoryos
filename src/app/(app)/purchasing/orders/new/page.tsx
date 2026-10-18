import { createPurchaseOrderAction } from "@/app/actions/purchasing";
import { PurchaseOrderForm } from "@/components/purchase-order-form";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { listWarehouses } from "@/server/modules/warehouses/service";

export const metadata = { title: "Nuevo pedido" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "purchasing.write");
  const sp = await searchParams;
  const [suppliers, warehouses, org] = await Promise.all([listSuppliers(ctx, { pageSize: 100 }), listWarehouses(ctx), getOrganization(ctx)]);
  return (
    <>
      <PageHeader title="Nuevo pedido a proveedor" description="Se guarda como borrador; podrás revisarlo antes de marcarlo como pedido." back={{ href: "/purchasing/orders", label: "Compras" }} />
      {suppliers.rows.length === 0 ? (
        <EmptyState title="Primero agrega un proveedor" description="Necesitas al menos un proveedor para hacerle pedidos." action={<LinkButton href="/purchasing/suppliers/new">Agregar proveedor</LinkButton>} />
      ) : (
        <Card>
          <PurchaseOrderForm
            action={createPurchaseOrderAction}
            suppliers={suppliers.rows}
            warehouses={warehouses}
            currency={org.currency}
            initial={{ supplierId: sp.supplier }}
            submitLabel="Guardar pedido"
          />
        </Card>
      )}
    </>
  );
}
