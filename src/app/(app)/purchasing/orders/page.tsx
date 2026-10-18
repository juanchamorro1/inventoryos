import Link from "next/link";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { PO_TONES } from "@/lib/status-tones";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { listPurchaseOrders, PO_STATUS_LABELS } from "@/server/modules/purchasing/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Compras" };


export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "purchasing.read");
  const sp = await searchParams;
  const [data, org] = await Promise.all([listPurchaseOrders(ctx, { search: sp.q, status: sp.status, page: Number(sp.page) || 1 }), getOrganization(ctx)]);
  return (
    <>
      <PageHeader
        title="Compras"
        description="Pedidos que le haces a tus proveedores."
        actions={can(ctx, "purchasing.write") && <LinkButton href="/purchasing/orders/new">Nuevo pedido</LinkButton>}
        help={
          <ol className="list-decimal space-y-1 pl-5">
            <li>Crea el pedido con los productos y lo que te cobra el proveedor.</li>
            <li>Cuando lo envíes al proveedor, pulsa «Marcar como pedido».</li>
            <li>Cuando llegue la mercancía, entra al pedido y registra lo que llegó. Puede llegar en varias partes.</li>
          </ol>
        }
      />
      <FilterBar action="/purchasing/orders">
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-xs text-muted" htmlFor="q">
            Buscar
          </label>
          <Input id="q" name="q" defaultValue={sp.q} placeholder="Número de pedido o proveedor" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="status">
            Estado
          </label>
          <Select id="status" name="status" defaultValue={sp.status ?? ""}>
            <option value="">Todos</option>
            {Object.entries(PO_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>
      {data.rows.length === 0 ? (
        <EmptyState title="No hay pedidos" description="Cuando le pidas mercancía a un proveedor, regístralo aquí para recibirla después (completa o por partes)." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Pedido</Th>
                <Th>Proveedor</Th>
                <Th>Bodega</Th>
                <Th>Fecha</Th>
                <Th>Estado</Th>
                <Th align="right">Llegó</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link className="font-medium hover:underline" href={`/purchasing/orders/${o.id}`}>
                      {o.number}
                    </Link>
                  </Td>
                  <Td>{o.supplierName}</Td>
                  <Td className="text-muted">{o.warehouseName}</Td>
                  <Td className="text-muted">{formatDate(o.createdAt, org.timezone)}</Td>
                  <Td>
                    <Badge tone={PO_TONES[o.status]}>{PO_STATUS_LABELS[o.status]}</Badge>
                  </Td>
                  <Td align="right">{formatNumber(Number(o.progress) * 100)} %</Td>
                  <Td align="right">{formatMoney(o.total, org.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/purchasing/orders" params={sp} />
        </>
      )}
    </>
  );
}
