import { redirect } from "next/navigation";
import { updatePurchaseOrderAction } from "@/app/actions/purchasing";
import { PurchaseOrderForm } from "@/components/purchase-order-form";
import { Card, PageHeader } from "@/components/ui";
import { trimDecimal } from "@/lib/decimal-text";
import { load, requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { getPurchaseOrder, listSuppliers } from "@/server/modules/purchasing/service";
import { listWarehouses } from "@/server/modules/warehouses/service";

export const metadata = { title: "Editar orden de compra" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "purchasing.write");
  const [po, suppliers, warehouses, org] = await Promise.all([load(getPurchaseOrder(ctx, id)), listSuppliers(ctx, { pageSize: 100 }), listWarehouses(ctx), getOrganization(ctx)]);
  if (po.status !== "draft") redirect(`/purchasing/orders/${id}`);
  return (
    <>
      <PageHeader title={`Editar ${po.number}`} back={{ href: `/purchasing/orders/${id}`, label: po.number }} />
      <Card>
        <PurchaseOrderForm
          action={updatePurchaseOrderAction}
          suppliers={suppliers.rows}
          warehouses={warehouses}
          currency={org.currency}
          submitLabel="Guardar cambios"
          initial={{
            id: po.id,
            supplierId: po.supplierId,
            warehouseId: po.warehouseId,
            expectedDate: po.expectedDate,
            notes: po.notes,
            lines: po.lines.map((l) => ({
              variantId: l.variantId,
              sku: l.sku,
              label: l.variantName ? `${l.productName} · ${l.variantName}` : l.productName,
              quantity: trimDecimal(l.quantityOrdered),
              unitCost: trimDecimal(l.unitCost),
              taxRate: trimDecimal(l.taxRate),
            })),
          }}
        />
      </Card>
    </>
  );
}
