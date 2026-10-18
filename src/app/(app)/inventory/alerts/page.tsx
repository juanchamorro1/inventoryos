import Link from "next/link";
import { Badge, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatQty } from "@/lib/format";
import { InventoryTabs } from "@/components/inventory-tabs";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { lowStock } from "@/server/modules/inventory/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Alertas de stock" };

export default async function AlertsPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "inventory.read");
  const rows = await lowStock(ctx, 500);
  return (
    <>
      <PageHeader
        title="Inventario"
        description="Productos que ya llegaron a la cantidad mínima que definiste. Es buen momento para pedirle al proveedor."
        actions={can(ctx, "purchasing.write") && <LinkButton href="/purchasing/orders/new">Hacer un pedido</LinkButton>}
      />
      <InventoryTabs active="/inventory/alerts" />
      {rows.length === 0 ? (
        <EmptyState title="Todo bien" description="Ningún producto ha llegado a su cantidad mínima. Puedes definir el mínimo al editar cada producto (campo «Avísame cuando queden»)." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th>Código</Th>
              <Th align="right">Tienes</Th>
              <Th align="right">Mínimo</Th>
              <Th align="right">Sugerido pedir</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variantId}>
                <Td>
                  <Link href={`/products/${r.productId}`} className="font-medium hover:underline">
                    {r.productName}
                  </Link>
                  {r.variantName && <span className="block text-xs text-muted">{r.variantName}</span>}
                </Td>
                <Td className="text-muted">{r.sku}</Td>
                <Td align="right">{formatQty(r.quantity)}</Td>
                <Td align="right">{formatQty(r.threshold)}</Td>
                <Td align="right">{formatQty(Math.max(0, Number(r.threshold) - Number(r.quantity)))}</Td>
                <Td>{Number(r.quantity) === 0 ? <Badge tone="danger">Agotado</Badge> : <Badge tone="warning">Por agotarse</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
