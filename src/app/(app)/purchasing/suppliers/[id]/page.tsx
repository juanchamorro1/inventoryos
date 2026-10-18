import Link from "next/link";
import { supplierStatusAction, updateSupplierAction } from "@/app/actions/purchasing";
import { ConfirmAction } from "@/components/confirm-action";
import { ActionForm, SubmitButton } from "@/components/form";
import { SupplierFields } from "@/components/supplier-fields";
import { Badge, Card, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { load, requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { getSupplier, listPurchaseOrders, PO_STATUS_LABELS } from "@/server/modules/purchasing/service";
import { can } from "@/server/platform/permissions";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "purchasing.read");
  const [s, orders, org] = await Promise.all([load(getSupplier(ctx, id)), listPurchaseOrders(ctx, { supplierId: id, pageSize: 20 }), getOrganization(ctx)]);
  const canWrite = can(ctx, "purchasing.write");
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {s.name} {s.status === "archived" && <Badge>Archivado</Badge>}
          </span>
        }
        back={{ href: "/purchasing/suppliers", label: "Proveedores" }}
        actions={
          canWrite && (
            <>
              <LinkButton href={`/purchasing/orders/new?supplier=${s.id}`}>Nueva orden</LinkButton>
              <ConfirmAction
                action={supplierStatusAction}
                hidden={{ id: s.id, op: s.status === "active" ? "archive" : "restore" }}
                label={s.status === "active" ? "Archivar" : "Restaurar"}
                title={s.status === "active" ? "¿Archivar proveedor?" : "¿Restaurar proveedor?"}
                description={s.status === "active" ? "No aparecerá al crear órdenes nuevas. Sus órdenes se conservan." : undefined}
                variant={s.status === "active" ? "danger" : "primary"}
              />
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Datos">
          {canWrite ? (
            <ActionForm action={updateSupplierAction}>
              <input type="hidden" name="id" value={s.id} />
              <SupplierFields s={s} />
              <SubmitButton>Guardar</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-sm">{[s.taxId, s.contactName, s.email, s.phone, s.address].filter(Boolean).join(" · ")}</p>
          )}
        </Card>
        <div>
          <h2 className="mb-3 text-lg font-semibold">Órdenes de compra</h2>
          {orders.rows.length === 0 ? (
            <p className="text-sm text-muted">Sin órdenes.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Número</Th>
                  <Th>Fecha</Th>
                  <Th>Estado</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {orders.rows.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <Link className="font-medium hover:underline" href={`/purchasing/orders/${o.id}`}>
                        {o.number}
                      </Link>
                    </Td>
                    <Td>{formatDate(o.createdAt, org.timezone)}</Td>
                    <Td>{PO_STATUS_LABELS[o.status]}</Td>
                    <Td align="right">{formatMoney(o.total, org.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}
