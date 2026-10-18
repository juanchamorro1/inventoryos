import { randomUUID } from "node:crypto";
import Link from "next/link";
import { cancelPurchaseOrderAction, issuePurchaseOrderAction, receivePurchaseOrderAction, reverseReceiptAction } from "@/app/actions/purchasing";
import { ConfirmAction } from "@/components/confirm-action";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { LocationSelect } from "@/components/location-select";
import { Badge, Card, cx, DescriptionList, inputClass, Label, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { load, requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { getPurchaseOrder, PO_STATUS_LABELS } from "@/server/modules/purchasing/service";
import { listLocationOptions } from "@/server/modules/warehouses/service";
import { can } from "@/server/platform/permissions";
import { PO_TONES } from "@/lib/status-tones";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "purchasing.read");
  const [po, org, locations] = await Promise.all([load(getPurchaseOrder(ctx, id)), getOrganization(ctx), listLocationOptions(ctx)]);
  const cur = org.currency;
  const canWrite = can(ctx, "purchasing.write");
  const canReceive = can(ctx, "purchasing.receive") && (po.status === "ordered" || po.status === "partially_received");
  const subtotal = po.lines.reduce((a, l) => a + Number(l.quantityOrdered) * Number(l.unitCost), 0);
  const tax = po.lines.reduce((a, l) => a + (Number(l.quantityOrdered) * Number(l.unitCost) * Number(l.taxRate)) / 100, 0);
  const pendingLines = po.lines.filter((l) => Number(l.quantityOrdered) > Number(l.quantityReceived));

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Pedido {po.number} <Badge tone={PO_TONES[po.status]}>{PO_STATUS_LABELS[po.status]}</Badge>
          </span>
        }
        back={{ href: "/purchasing/orders", label: "Compras" }}
        actions={
          canWrite && (
            <>
              {po.status === "draft" && (
                <>
                  <LinkButton href={`/purchasing/orders/${po.id}/edit`} variant="secondary">
                    Editar
                  </LinkButton>
                  <ConfirmAction
                    action={issuePurchaseOrderAction}
                    hidden={{ id: po.id }}
                    label="Marcar como pedido"
                    title="¿Ya le enviaste este pedido al proveedor?"
                    description="Después de esto ya no podrás editarlo, y podrás registrar la mercancía cuando llegue."
                    confirmLabel="Sí, marcar como pedido"
                    variant="primary"
                  />
                </>
              )}
              {["draft", "ordered", "partially_received"].includes(po.status) && (
                <ConfirmAction
                  action={cancelPurchaseOrderAction}
                  hidden={{ id: po.id }}
                  label={po.status === "partially_received" ? "No llegará el resto" : "Cancelar pedido"}
                  title={po.status === "partially_received" ? "¿El resto del pedido ya no llegará?" : "¿Cancelar el pedido?"}
                  description={
                    po.status === "partially_received"
                      ? "Lo que ya llegó se conserva. El pedido se cierra y no se esperará lo pendiente."
                      : "El pedido quedará cancelado. No se puede deshacer."
                  }
                  confirmLabel="Confirmar"
                  requireReason
                />
              )}
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Datos" className="lg:col-span-2">
          <DescriptionList
            items={[
              {
                label: "Proveedor",
                value: (
                  <Link className="text-primary hover:underline" href={`/purchasing/suppliers/${po.supplierId}`}>
                    {po.supplierName}
                  </Link>
                ),
              },
              { label: "Llega a", value: po.warehouseName },
              { label: "Creada", value: `${formatDateTime(po.createdAt, org.timezone)} por ${po.userName}` },
              { label: "Fecha esperada de llegada", value: po.expectedDate ? formatDate(po.expectedDate) : "—" },
              { label: "Comentario", value: po.notes },
            ]}
          />
        </Card>
        <Card title="Totales">
          <DescriptionList
            items={[
              { label: "Subtotal", value: formatMoney(subtotal, cur) },
              { label: "IVA", value: formatMoney(tax, cur) },
              { label: "Total", value: <span className="font-semibold">{formatMoney(subtotal + tax, cur)}</span> },
            ]}
          />
        </Card>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Productos</h2>
      <Table>
        <thead>
          <tr>
            <Th>Producto</Th>
            <Th align="right">Pedido</Th>
            <Th align="right">Llegó</Th>
            <Th align="right">Falta</Th>
            <Th align="right">Costo c/u</Th>
            <Th align="right">IVA</Th>
            <Th align="right">Subtotal</Th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((l) => (
            <tr key={l.id}>
              <Td>
                {l.productName}
                <span className="block text-xs text-muted">
                  {l.sku}
                  {l.variantName ? ` · ${l.variantName}` : ""}
                </span>
              </Td>
              <Td align="right">{formatQty(l.quantityOrdered)}</Td>
              <Td align="right">{formatQty(l.quantityReceived)}</Td>
              <Td align="right">{formatQty(Number(l.quantityOrdered) - Number(l.quantityReceived))}</Td>
              <Td align="right">{formatMoney(l.unitCost, cur)}</Td>
              <Td align="right">{formatQty(l.taxRate)} %</Td>
              <Td align="right">{formatMoney(Number(l.quantityOrdered) * Number(l.unitCost), cur)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {canReceive && pendingLines.length > 0 && (
        <Card title="¿Llegó mercancía de este pedido?" className="mt-8">
          <ActionForm action={receivePurchaseOrderAction}>
            <input type="hidden" name="id" value={po.id} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="locationId">¿Dónde la guardas?</Label>
                <LocationSelect name="locationId" locations={locations} warehouseId={po.warehouseId} />
                <FieldError name="locationId" />
              </div>
              <div>
                <Label htmlFor="notes">N.º de factura o remisión (opcional)</Label>
                <input id="notes" name="notes" className={inputClass} maxLength={1000} />
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-bg/60 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-3 py-2 text-right">Falta por llegar</th>
                    <th className="px-3 py-2 text-right">¿Cuántas llegaron?</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingLines.map((l) => {
                    const pending = Number(l.quantityOrdered) - Number(l.quantityReceived);
                    return (
                      <tr key={l.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          {l.productName}
                          <span className="block text-xs text-muted">{l.sku}</span>
                        </td>
                        <td className="num px-3 py-2 text-right">{formatQty(pending)}</td>
                        <td className="px-3 py-2">
                          <input name={`qty:${l.id}`} aria-label={`Cantidad recibida de ${l.sku}`} inputMode="decimal" defaultValue={String(pending)} className={cx(inputClass, "num ml-auto h-9 w-32 text-right")} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Revisa y cambia las cantidades si llegó menos. Deja en 0 lo que no llegó: podrás registrarlo cuando llegue.</p>
            <div className="flex justify-end">
              <SubmitButton pendingText="Guardando…">Guardar lo que llegó</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      <h2 className="mt-8 mb-3 text-lg font-semibold">Entregas recibidas</h2>
      {po.receipts.length === 0 ? (
        <p className="text-sm text-muted">Todavía no ha llegado nada de este pedido.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Entrega</Th>
              <Th>Fecha</Th>
              <Th>Bodega</Th>
              <Th align="right">Unidades</Th>
              <Th>Estado</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {po.receipts.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link className="font-medium hover:underline" href={`/inventory/documents/${r.stockDocumentId}`}>
                    {r.number}
                  </Link>
                  <span className="block text-xs text-muted">{r.userName}</span>
                </Td>
                <Td className="text-muted">{formatDateTime(r.createdAt, org.timezone)}</Td>
                <Td>{r.locationCode}</Td>
                <Td align="right">{formatQty(r.units)}</Td>
                <Td>
                  {r.reversedAt ? (
                    <Link href={`/inventory/documents/${r.reversalDocumentId}`}>
                      <Badge tone="danger">Anulada</Badge>
                    </Link>
                  ) : (
                    <Badge tone="success">Recibida</Badge>
                  )}
                </Td>
                <Td align="right">
                  {!r.reversedAt && canWrite && (
                    <ConfirmAction
                      action={reverseReceiptAction}
                      hidden={{ receiptId: r.id, orderId: po.id }}
                      label="Anular"
                      size="sm"
                      title="¿Anular esta entrega?"
                      description="Úsalo si registraste mal la entrega o devolviste la mercancía. Las unidades se restan del inventario (deben seguir en la bodega)."
                      confirmLabel="Anular entrega"
                      requireReason
                    />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
