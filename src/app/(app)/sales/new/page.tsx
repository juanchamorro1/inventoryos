import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createSaleAction } from "@/app/actions/sales";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { LineItemsEditor } from "@/components/line-items-editor";
import { LocationSelect } from "@/components/location-select";
import { Card, Input, Label, PageHeader, Select } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { listCustomers, PAYMENT_METHODS } from "@/server/modules/sales/service";
import { listLocationOptions } from "@/server/modules/warehouses/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Vender" };

export default async function NewSalePage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "sales.write");
  const [locations, customers, org] = await Promise.all([listLocationOptions(ctx), listCustomers(ctx, { pageSize: 100 }), getOrganization(ctx)]);
  const canEditPrice = can(ctx, "sales.manage");
  return (
    <>
      <PageHeader title="Vender" description="Busca o escanea los productos, revisa el total y guarda. Las unidades se descuentan solas del inventario." back={{ href: "/sales", label: "Ventas" }} />
      <Card>
        <ActionForm action={createSaleAction}>
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="locationId">¿De qué bodega sale?</Label>
              <LocationSelect name="locationId" locations={locations} />
              <FieldError name="locationId" />
            </div>
            <div>
              <Label htmlFor="customerId">Cliente (opcional)</Label>
              <Select id="customerId" name="customerId" defaultValue="">
                <option value="">Cliente sin registrar</option>
                {customers.rows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.documentNumber ? ` · ${c.documentNumber}` : ""}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted">
                ¿Cliente nuevo?{" "}
                <Link className="text-primary hover:underline" href="/customers" target="_blank">
                  Créalo aquí
                </Link>{" "}
                y recarga.
              </p>
            </div>
            <div>
              <Label htmlFor="paymentMethod">¿Cómo pagó?</Label>
              <Select id="paymentMethod" name="paymentMethod" defaultValue="cash">
                {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>Productos</Label>
            <LineItemsEditor mode="sale" locationField="locationId" currency={org.currency} canEditPrice={canEditPrice} />
            <FieldError name="lines" />
            {!canEditPrice && <p className="mt-1 text-xs text-muted">Se cobra el precio registrado de cada producto. Para descuentos pide ayuda a un gerente.</p>}
          </div>
          <div>
            <Label htmlFor="notes">Comentario (opcional)</Label>
            <Input id="notes" name="notes" maxLength={1000} />
          </div>
          <div className="flex justify-end">
            <SubmitButton pendingText="Guardando…" className="h-12 min-w-48 text-base">Confirmar venta</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
