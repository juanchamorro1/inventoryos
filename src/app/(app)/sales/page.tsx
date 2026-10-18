import Link from "next/link";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { SALE_TONES } from "@/lib/status-tones";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { listSales, PAYMENT_METHODS, SALE_STATUS_LABELS } from "@/server/modules/sales/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Ventas" };

type SP = { q?: string; status?: string; from?: string; to?: string; page?: string };

export default async function SalesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "sales.read");
  const sp = await searchParams;
  const [data, org] = await Promise.all([listSales(ctx, { search: sp.q, status: sp.status, from: sp.from, to: sp.to, page: Number(sp.page) || 1 }), getOrganization(ctx)]);
  return (
    <>
      <PageHeader title="Ventas" description="Todas tus ventas. Entra a una para ver el detalle, registrar una devolución o anularla." actions={can(ctx, "sales.write") && <LinkButton href="/sales/new">Vender</LinkButton>} />
      <FilterBar action="/sales">
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-muted" htmlFor="q">
            Número o cliente
          </label>
          <Input id="q" name="q" defaultValue={sp.q} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="status">
            Estado
          </label>
          <Select id="status" name="status" defaultValue={sp.status ?? ""}>
            <option value="">Todos</option>
            {Object.entries(SALE_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="from">
            Desde
          </label>
          <Input id="from" name="from" type="date" defaultValue={sp.from} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="to">
            Hasta
          </label>
          <Input id="to" name="to" type="date" defaultValue={sp.to} />
        </div>
      </FilterBar>
      {data.rows.length === 0 ? (
        <EmptyState title="No hay ventas" description="Las ventas registradas aparecerán aquí." action={can(ctx, "sales.write") ? <LinkButton href="/sales/new">Registrar venta</LinkButton> : undefined} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Venta</Th>
                <Th>Fecha</Th>
                <Th>Cliente</Th>
                <Th>Pagó con</Th>
                <Th>Estado</Th>
                <Th align="right">Productos</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link className="font-medium hover:underline" href={`/sales/${s.id}`}>
                      {s.number}
                    </Link>
                    <span className="block text-xs text-muted">{s.userName}</span>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(s.createdAt, org.timezone)}</Td>
                  <Td>{s.customerName ?? <span className="text-muted">Sin registrar</span>}</Td>
                  <Td className="text-muted">{PAYMENT_METHODS[s.paymentMethod as keyof typeof PAYMENT_METHODS]}</Td>
                  <Td>
                    <Badge tone={SALE_TONES[s.status]}>{SALE_STATUS_LABELS[s.status]}</Badge>
                  </Td>
                  <Td align="right">{formatQty(s.items)}</Td>
                  <Td align="right">{formatMoney(s.total, org.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/sales" params={sp} />
        </>
      )}
    </>
  );
}
