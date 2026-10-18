import Link from "next/link";
import { createCustomerAction } from "@/app/actions/sales";
import { CustomerFields } from "@/components/customer-fields";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, EmptyState, FilterBar, Input, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { listCustomers } from "@/server/modules/sales/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "sales.read");
  const sp = await searchParams;
  const [data, org] = await Promise.all([listCustomers(ctx, { search: sp.q, page: Number(sp.page) || 1 }), getOrganization(ctx)]);
  return (
    <>
      <PageHeader title="Clientes" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <FilterBar action="/customers">
            <div className="min-w-56 flex-1">
              <label className="mb-1 block text-xs text-muted" htmlFor="q">
                Buscar
              </label>
              <Input id="q" name="q" defaultValue={sp.q} placeholder="Nombre, documento, teléfono o correo" />
            </div>
          </FilterBar>
          {data.rows.length === 0 ? (
            <EmptyState title="No hay clientes" description="Registrar clientes es opcional: también puedes vender a consumidor final." />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Cliente</Th>
                    <Th>Contacto</Th>
                    <Th align="right">Compras</Th>
                    <Th align="right">Total comprado</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((c) => (
                    <tr key={c.id}>
                      <Td>
                        <Link className="font-medium hover:underline" href={`/customers/${c.id}`}>
                          {c.name}
                        </Link>
                        {c.documentNumber && <span className="block text-xs text-muted">{c.documentNumber}</span>}
                      </Td>
                      <Td className="text-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</Td>
                      <Td align="right">{c.salesCount}</Td>
                      <Td align="right">{formatMoney(c.salesTotal, org.currency)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/customers" params={sp} />
            </>
          )}
        </div>
        {can(ctx, "sales.write") && (
          <Card title="Nuevo cliente">
            <ActionForm action={createCustomerAction} resetOnSuccess>
              <CustomerFields />
              <SubmitButton>Crear cliente</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
