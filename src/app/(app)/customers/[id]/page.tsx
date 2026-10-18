import Link from "next/link";
import { archiveCustomerAction, updateCustomerAction } from "@/app/actions/sales";
import { ConfirmAction } from "@/components/confirm-action";
import { CustomerFields } from "@/components/customer-fields";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { SALE_TONES } from "@/lib/status-tones";
import { load, requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { getCustomer, listSales, SALE_STATUS_LABELS } from "@/server/modules/sales/service";
import { can } from "@/server/platform/permissions";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "sales.read");
  const [c, sales, org] = await Promise.all([load(getCustomer(ctx, id)), listSales(ctx, { customerId: id, pageSize: 50 }), getOrganization(ctx)]);
  return (
    <>
      <PageHeader
        title={c.name}
        back={{ href: "/customers", label: "Clientes" }}
        actions={
          can(ctx, "sales.manage") &&
          c.status === "active" && (
            <ConfirmAction action={archiveCustomerAction} hidden={{ id: c.id }} label="Archivar" title="¿Archivar cliente?" description="Sus ventas se conservan." confirmLabel="Archivar" />
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Datos">
          {can(ctx, "sales.write") ? (
            <ActionForm action={updateCustomerAction}>
              <input type="hidden" name="id" value={c.id} />
              <CustomerFields c={c} />
              <SubmitButton>Guardar</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-sm">{[c.documentNumber, c.phone, c.email].filter(Boolean).join(" · ")}</p>
          )}
        </Card>
        <div>
          <h2 className="mb-3 text-lg font-semibold">Historial de compras</h2>
          {sales.rows.length === 0 ? (
            <p className="text-sm text-muted">Sin compras registradas.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Venta</Th>
                  <Th>Fecha</Th>
                  <Th>Estado</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {sales.rows.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <Link className="font-medium hover:underline" href={`/sales/${s.id}`}>
                        {s.number}
                      </Link>
                    </Td>
                    <Td className="text-muted">{formatDateTime(s.createdAt, org.timezone)}</Td>
                    <Td>
                      <Badge tone={SALE_TONES[s.status]}>{SALE_STATUS_LABELS[s.status]}</Badge>
                    </Td>
                    <Td align="right">{formatMoney(s.total, org.currency)}</Td>
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
