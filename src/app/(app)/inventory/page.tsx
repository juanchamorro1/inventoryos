import Link from "next/link";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { formatMoney, formatQty } from "@/lib/format";
import { InventoryTabs } from "@/components/inventory-tabs";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { listStock } from "@/server/modules/inventory/service";
import { getOrganization } from "@/server/modules/organizations/service";
import { listWarehouses } from "@/server/modules/warehouses/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Existencias" };

type SP = { q?: string; warehouse?: string; status?: string; page?: string };

export default async function StockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "inventory.read");
  const sp = await searchParams;
  const status = sp.status === "low" || sp.status === "out" ? sp.status : "all";
  const [data, warehouses, org] = await Promise.all([
    listStock(ctx, { search: sp.q, warehouseId: sp.warehouse || undefined, status, page: Number(sp.page) || 1 }),
    listWarehouses(ctx),
    getOrganization(ctx),
  ]);
  const canWrite = can(ctx, "inventory.write");
  return (
    <>
      <PageHeader
        title="Inventario"
        description="Cuántas unidades tienes de cada producto y cuánto valen."
        actions={canWrite && <LinkButton href="/inventory/new">Ajustar inventario</LinkButton>}
        help={
          <>
            <p>Las cantidades cambian solas cuando vendes, recibes pedidos o registras devoluciones.</p>
            <p>Usa «Ajustar inventario» solo para casos especiales: mercancía que llega sin pedido, productos dañados, conteos que no cuadran o traslados entre bodegas.</p>
            <p>El valor se calcula con el costo promedio: el promedio de lo que has pagado por cada unidad.</p>
          </>
        }
      />
      <InventoryTabs active="/inventory" />
      <FilterBar action="/inventory">
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-xs text-muted" htmlFor="q">
            Buscar
          </label>
          <Input id="q" name="q" defaultValue={sp.q} placeholder="Nombre, código o código de barras" />
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
          <label className="mb-1 block text-xs text-muted" htmlFor="status">
            Mostrar
          </label>
          <Select id="status" name="status" defaultValue={status}>
            <option value="all">Todos</option>
            <option value="low">Por agotarse</option>
            <option value="out">Agotados</option>
          </Select>
        </div>
      </FilterBar>
      {data.rows.length === 0 ? (
        <EmptyState title="No hay productos que mostrar" description={sp.q || status !== "all" ? "Ajusta los filtros." : "Crea productos y registra entradas para ver existencias."} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th>Código</Th>
                <Th align="right">Tienes</Th>
                <Th align="right">Mínimo</Th>
                <Th align="right">Costo promedio</Th>
                <Th align="right">Valor</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const qty = Number(r.quantity);
                const low = Number(r.lowStockThreshold) > 0 && qty <= Number(r.lowStockThreshold);
                return (
                  <tr key={r.variantId}>
                    <Td>
                      <Link href={`/products/${r.productId}`} className="font-medium hover:underline">
                        {r.productName}
                      </Link>
                      {r.variantName && <span className="block text-xs text-muted">{r.variantName}</span>}
                    </Td>
                    <Td className="text-muted">{r.sku}</Td>
                    <Td align="right">
                      {formatQty(r.quantity)} <span className="text-xs text-muted">{r.unit}</span>
                    </Td>
                    <Td align="right">{Number(r.lowStockThreshold) > 0 ? formatQty(r.lowStockThreshold) : "—"}</Td>
                    <Td align="right">{qty > 0 ? formatMoney(Number(r.value) / qty, org.currency) : "—"}</Td>
                    <Td align="right">{formatMoney(r.value, org.currency)}</Td>
                    <Td>{qty === 0 ? <Badge tone="danger">Agotado</Badge> : low ? <Badge tone="warning">Por agotarse</Badge> : null}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/inventory" params={sp} />
        </>
      )}
    </>
  );
}
