import Link from "next/link";
import { createWarehouseAction } from "@/app/actions/inventory";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Badge, Card, Input, Label, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatMoney, formatQty } from "@/lib/format";
import { InventoryTabs } from "@/components/inventory-tabs";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { listWarehouses } from "@/server/modules/warehouses/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Bodegas" };

export default async function WarehousesPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "inventory.read");
  const [rows, org] = await Promise.all([listWarehouses(ctx, { includeArchived: true }), getOrganization(ctx)]);
  return (
    <>
      <PageHeader title="Inventario" description={`Tus bodegas y tiendas. Dentro de cada una puedes crear ubicaciones (vitrina, estante…) si lo necesitas. Tu plan permite ${org.planInfo.maxWarehouses === Infinity ? "bodegas ilimitadas" : `hasta ${org.planInfo.maxWarehouses} bodegas`}.`} />
      <InventoryTabs active="/warehouses" />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Table>
          <thead>
            <tr>
              <Th>Bodega</Th>
              <Th align="right">Ubicaciones</Th>
              <Th align="right">Unidades</Th>
              <Th align="right">Valor</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id}>
                <Td>
                  <Link href={`/warehouses/${w.id}`} className="font-medium hover:underline">
                    {w.name}
                  </Link>
                  <span className="block text-xs text-muted">
                    {w.code}
                    {w.address ? ` · ${w.address}` : ""}
                  </span>
                </Td>
                <Td align="right">{w.locationCount}</Td>
                <Td align="right">{formatQty(w.units)}</Td>
                <Td align="right">{formatMoney(w.value, org.currency)}</Td>
                <Td>
                  {w.isDefault && <Badge tone="primary">Principal</Badge>} {w.status === "archived" && <Badge>Archivada</Badge>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {can(ctx, "settings.manage") && (
          <Card title="Nueva bodega">
            <ActionForm action={createWarehouseAction}>
              <div>
                <Label htmlFor="code">Código corto</Label>
                <Input id="code" name="code" placeholder="Ej.: NORTE" required maxLength={30} />
                <FieldError name="code" />
              </div>
              <div>
                <Label htmlFor="name">Nombre</Label>
                <Input id="name" name="name" required maxLength={120} />
                <FieldError name="name" />
              </div>
              <div>
                <Label htmlFor="address">Dirección</Label>
                <Input id="address" name="address" maxLength={300} />
              </div>
              <SubmitButton>Crear bodega</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
