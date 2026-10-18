import Link from "next/link";
import { EmptyState, FilterBar, Input, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { InventoryTabs } from "@/components/inventory-tabs";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { DOC_TYPE_LABELS, listMovements } from "@/server/modules/inventory/service";
import { getOrganization } from "@/server/modules/organizations/service";
import { listWarehouses } from "@/server/modules/warehouses/service";

export const metadata = { title: "Movimientos" };

type SP = { q?: string; type?: string; warehouse?: string; from?: string; to?: string; page?: string };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "inventory.read");
  const sp = await searchParams;
  const [data, warehouses, org] = await Promise.all([
    listMovements(ctx, { search: sp.q, type: sp.type, warehouseId: sp.warehouse || undefined, from: sp.from, to: sp.to, page: Number(sp.page) || 1 }),
    listWarehouses(ctx, { includeArchived: true }),
    getOrganization(ctx),
  ]);
  return (
    <>
      <PageHeader title="Inventario" description="Cada entrada y salida queda registrada aquí y no se puede borrar. Si algo se corrige, verás el movimiento que lo deshace." />
      <InventoryTabs active="/inventory/movements" />
      <FilterBar action="/inventory/movements">
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-muted" htmlFor="q">
            Producto, código o comprobante
          </label>
          <Input id="q" name="q" defaultValue={sp.q} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="type">
            Tipo
          </label>
          <Select id="type" name="type" defaultValue={sp.type ?? ""}>
            <option value="">Todos</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="warehouse">
            Bodega
          </label>
          <Select id="warehouse" name="warehouse" defaultValue={sp.warehouse ?? ""}>
            <option value="">Todas</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
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
        <EmptyState title="No hay movimientos" description="Ajusta los filtros o registra una entrada de inventario." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Qué pasó</Th>
                <Th>Producto</Th>
                <Th>Bodega</Th>
                <Th align="right">Cantidad</Th>
                <Th align="right">Costo c/u</Th>
                <Th align="right">Quedaron</Th>
                <Th>Quién</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(m.createdAt, org.timezone)}</Td>
                  <Td>
                    <Link href={`/inventory/documents/${m.documentId}`} className="font-medium hover:underline">
                      {DOC_TYPE_LABELS[m.type]}
                    </Link>
                    <span className="block text-xs text-muted">{m.reason}</span>
                  </Td>
                  <Td>
                    {m.productName}
                    <span className="block text-xs text-muted">
                      {m.sku}
                      {m.variantName ? ` · ${m.variantName}` : ""}
                    </span>
                  </Td>
                  <Td className="text-muted">
                    {m.locationCode === "GENERAL" ? m.warehouseName : `${m.warehouseName} · ${m.locationCode}`}
                  </Td>
                  <Td align="right" className={Number(m.quantity) < 0 ? "text-danger" : "text-success"}>
                    {Number(m.quantity) > 0 ? "+" : ""}
                    {formatQty(m.quantity)}
                  </Td>
                  <Td align="right">{formatMoney(m.unitCost, org.currency)}</Td>
                  <Td align="right">{formatQty(m.locationQtyAfter)}</Td>
                  <Td className="text-muted">{m.userName}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/inventory/movements" params={sp} />
        </>
      )}
    </>
  );
}
