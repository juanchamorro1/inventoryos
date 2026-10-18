import { createLocationAction, locationStatusAction, updateWarehouseAction, warehouseStatusAction } from "@/app/actions/inventory";
import { ConfirmAction } from "@/components/confirm-action";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Badge, Card, Input, Label, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatQty } from "@/lib/format";
import { load, requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getWarehouse } from "@/server/modules/warehouses/service";
import { can } from "@/server/platform/permissions";

export default async function WarehousePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "inventory.read");
  const wh = await load(getWarehouse(ctx, id));
  const manage = can(ctx, "settings.manage");
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {wh.name} {wh.isDefault && <Badge tone="primary">Principal</Badge>} {wh.status === "archived" && <Badge>Archivada</Badge>}
          </span>
        }
        back={{ href: "/warehouses", label: "Bodegas" }}
        actions={
          manage && (
            <>
              {!wh.isDefault && wh.status === "active" && (
                <ConfirmAction action={warehouseStatusAction} hidden={{ id: wh.id, op: "default" }} label="Marcar como principal" title="¿Usar esta bodega como principal?" confirmLabel="Confirmar" variant="primary" />
              )}
              {wh.status === "active" ? (
                !wh.isDefault && (
                  <ConfirmAction
                    action={warehouseStatusAction}
                    hidden={{ id: wh.id, op: "archive" }}
                    label="Archivar"
                    title="¿Archivar esta bodega?"
                    description="Solo es posible si no tiene existencias ni órdenes de compra abiertas. El historial se conserva."
                    confirmLabel="Archivar"
                  />
                )
              ) : (
                <ConfirmAction action={warehouseStatusAction} hidden={{ id: wh.id, op: "restore" }} label="Restaurar" title="¿Restaurar esta bodega?" confirmLabel="Restaurar" variant="primary" />
              )}
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Ubicaciones</h2>
          <Table>
            <thead>
              <tr>
                <Th>Código</Th>
                <Th>Nombre</Th>
                <Th align="right">Unidades</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {wh.locations.map((l) => (
                <tr key={l.id}>
                  <Td className="font-medium">{l.code}</Td>
                  <Td>
                    {l.name} {l.isDefault && <Badge tone="primary">Predeterminada</Badge>} {l.status === "archived" && <Badge>Archivada</Badge>}
                  </Td>
                  <Td align="right">{formatQty(l.units)}</Td>
                  <Td align="right">
                    {manage && !l.isDefault && (
                      <ConfirmAction
                        action={locationStatusAction}
                        hidden={{ id: l.id, warehouseId: wh.id, op: l.status === "active" ? "archive" : "restore" }}
                        label={l.status === "active" ? "Archivar" : "Restaurar"}
                        title={l.status === "active" ? `¿Archivar ${l.code}?` : `¿Restaurar ${l.code}?`}
                        description={l.status === "active" ? "Debe estar vacía." : undefined}
                        confirmLabel="Confirmar"
                        variant={l.status === "active" ? "danger" : "primary"}
                        size="sm"
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        {manage && (
          <div className="space-y-6">
            <Card title="Nueva ubicación">
              <ActionForm action={createLocationAction} resetOnSuccess>
                <input type="hidden" name="warehouseId" value={wh.id} />
                <div>
                  <Label htmlFor="code">Código</Label>
                  <Input id="code" name="code" placeholder="VITRINA-1" required maxLength={30} />
                  <FieldError name="code" />
                </div>
                <div>
                  <Label htmlFor="lname">Nombre</Label>
                  <Input id="lname" name="name" required maxLength={120} />
                  <FieldError name="name" />
                </div>
                <SubmitButton>Agregar ubicación</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Datos de la bodega">
              <ActionForm action={updateWarehouseAction} successMessage="Guardado.">
                <input type="hidden" name="id" value={wh.id} />
                <div>
                  <Label htmlFor="wcode">Código</Label>
                  <Input id="wcode" name="code" defaultValue={wh.code} required maxLength={30} />
                  <FieldError name="code" />
                </div>
                <div>
                  <Label htmlFor="wname">Nombre</Label>
                  <Input id="wname" name="name" defaultValue={wh.name} required maxLength={120} />
                  <FieldError name="name" />
                </div>
                <div>
                  <Label htmlFor="waddress">Dirección</Label>
                  <Input id="waddress" name="address" defaultValue={wh.address ?? ""} maxLength={300} />
                </div>
                <SubmitButton>Guardar</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
