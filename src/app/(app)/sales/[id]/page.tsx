import { randomUUID } from "node:crypto";
import Link from "next/link";
import { cancelSaleAction, returnSaleAction } from "@/app/actions/sales";
import { ConfirmAction } from "@/components/confirm-action";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, cx, DescriptionList, Input, inputClass, Label, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatMoney, formatPercent, formatQty } from "@/lib/format";
import { SALE_TONES } from "@/lib/status-tones";
import { load, requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { getSale, PAYMENT_METHODS, SALE_STATUS_LABELS } from "@/server/modules/sales/service";
import { can } from "@/server/platform/permissions";

export default async function SalePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "sales.read");
  const [sale, org] = await Promise.all([load(getSale(ctx, id)), getOrganization(ctx)]);
  const cur = org.currency;
  const canManage = can(ctx, "sales.manage");
  const returnable = sale.lines.filter((l) => Number(l.quantity) > Number(l.quantityReturned));
  const canReturn = canManage && (sale.status === "confirmed" || sale.status === "partially_returned") && returnable.length > 0;
  const refunded = sale.returns.reduce((a, r) => a + Number(r.refundTotal), 0);
  const margin = Number(sale.subtotal) - Number(sale.discountTotal) - Number(sale.costTotal);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Venta {sale.number} <Badge tone={SALE_TONES[sale.status]}>{SALE_STATUS_LABELS[sale.status]}</Badge>
          </span>
        }
        back={{ href: "/sales", label: "Ventas" }}
        actions={
          <>
            {can(ctx, "sales.write") && (
              <LinkButton href="/sales/new" variant="secondary">
                Otra venta
              </LinkButton>
            )}
            {canManage && sale.status === "confirmed" && (
              <ConfirmAction
                action={cancelSaleAction}
                hidden={{ id: sale.id }}
                label="Anular venta"
                title={`¿Anular la venta ${sale.number}?`}
                description="Úsalo si la venta se registró por error. Las unidades vuelven al inventario y la venta queda marcada como anulada (no se borra)."
                confirmLabel="Anular"
                requireReason
              />
            )}
          </>
        }
      />
      {sp.created && (
        <div className="mb-4">
          <Alert tone="success">Venta registrada correctamente.</Alert>
        </div>
      )}
      {sale.status === "cancelled" && (
        <div className="mb-4">
          <Alert tone="warning">
            Anulada el {formatDateTime(sale.cancelledAt, org.timezone)}. Motivo: {sale.cancelReason}.{" "}
            {sale.cancellationDocumentId && (
              <Link className="underline" href={`/inventory/documents/${sale.cancellationDocumentId}`}>
                Ver movimiento de reingreso
              </Link>
            )}
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Datos" className="lg:col-span-2">
          <DescriptionList
            items={[
              { label: "Fecha", value: formatDateTime(sale.createdAt, org.timezone) },
              { label: "Vendedor", value: sale.userName },
              { label: "Cliente", value: sale.customerName ?? "Sin registrar" },
              { label: "Forma de pago", value: PAYMENT_METHODS[sale.paymentMethod as keyof typeof PAYMENT_METHODS] },
              { label: "Salió de", value: sale.locationCode === "GENERAL" ? sale.warehouseName : `${sale.warehouseName} · ${sale.locationCode}` },
              {
                label: "Inventario",
                value: (
                  <Link className="text-primary hover:underline" href={`/inventory/documents/${sale.stockDocumentId}`}>
                    Ver qué se descontó
                  </Link>
                ),
              },
              { label: "Comentario", value: sale.notes },
            ]}
          />
        </Card>
        <Card title="Totales">
          <DescriptionList
            items={[
              { label: "Subtotal", value: formatMoney(sale.subtotal, cur) },
              { label: "Descuentos", value: formatMoney(sale.discountTotal, cur) },
              { label: "Impuestos", value: formatMoney(sale.taxTotal, cur) },
              { label: "Total", value: <span className="text-lg font-semibold">{formatMoney(sale.total, cur)}</span> },
              ...(refunded > 0 ? [{ label: "Reembolsado", value: formatMoney(refunded, cur) }] : []),
              ...(canManage ? [{ label: "Te costó / ganaste", value: `${formatMoney(sale.costTotal, cur)} / ${formatMoney(margin, cur)}` }] : []),
            ]}
          />
        </Card>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Productos</h2>
      <Table>
        <thead>
          <tr>
            <Th>Producto</Th>
            <Th align="right">Cant.</Th>
            <Th align="right">Devuelto</Th>
            <Th align="right">Precio</Th>
            <Th align="right">Desc.</Th>
            <Th align="right">IVA</Th>
            <Th align="right">Total</Th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((l) => (
            <tr key={l.id}>
              <Td>
                {l.productName}
                <span className="block text-xs text-muted">
                  {l.sku}
                  {l.variantName ? ` · ${l.variantName}` : ""}
                </span>
              </Td>
              <Td align="right">{formatQty(l.quantity)}</Td>
              <Td align="right">{Number(l.quantityReturned) > 0 ? formatQty(l.quantityReturned) : "—"}</Td>
              <Td align="right">{formatMoney(l.unitPrice, cur)}</Td>
              <Td align="right">{Number(l.discount) > 0 ? formatMoney(l.discount, cur) : "—"}</Td>
              <Td align="right">{formatPercent(l.taxRate)}</Td>
              <Td align="right">{formatMoney(l.lineTotal, cur)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {canReturn && (
        <Card title="¿El cliente devolvió algo?" className="mt-8">
          <ActionForm action={returnSaleAction}>
            <input type="hidden" name="id" value={sale.id} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="bg-bg/60 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-3 py-2 text-right">Compró</th>
                    <th className="px-3 py-2 text-right">¿Cuántas devuelve?</th>
                  </tr>
                </thead>
                <tbody>
                  {returnable.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        {l.productName}
                        <span className="block text-xs text-muted">{l.sku}</span>
                      </td>
                      <td className="num px-3 py-2 text-right">{formatQty(Number(l.quantity) - Number(l.quantityReturned))}</td>
                      <td className="px-3 py-2">
                        <input name={`ret:${l.id}`} aria-label={`Devolver ${l.sku}`} inputMode="decimal" defaultValue="0" className={cx(inputClass, "num ml-auto h-9 w-28 text-right")} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="max-w-xl">
              <Label htmlFor="reason">¿Por qué lo devuelve?</Label>
              <Input id="reason" name="reason" required maxLength={300} placeholder="Ej.: equipo con falla de fábrica" />
              <FieldError name="reason" />
            </div>
            <p className="text-xs text-muted">Las unidades vuelven al inventario. El valor a reembolsar se calcula según lo que pagó el cliente.</p>
            <div className="flex justify-end">
              <SubmitButton pendingText="Registrando…">Registrar devolución</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      {sale.returns.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-semibold">Devoluciones</h2>
          <Table>
            <thead>
              <tr>
                <Th>Número</Th>
                <Th>Fecha</Th>
                <Th>Motivo</Th>
                <Th>Registró</Th>
                <Th align="right">Reembolso</Th>
              </tr>
            </thead>
            <tbody>
              {sale.returns.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link className="font-medium hover:underline" href={`/inventory/documents/${r.stockDocumentId}`}>
                      {r.number}
                    </Link>
                  </Td>
                  <Td className="text-muted">{formatDateTime(r.createdAt, org.timezone)}</Td>
                  <Td>{r.reason}</Td>
                  <Td className="text-muted">{r.userName}</Td>
                  <Td align="right">{formatMoney(r.refundTotal, cur)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
}
