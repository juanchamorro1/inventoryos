import Link from "next/link";
import { reverseDocumentAction } from "@/app/actions/inventory";
import { ConfirmAction } from "@/components/confirm-action";
import { Alert, Card, DescriptionList, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { load, requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { DOC_TYPE_LABELS, getDocument } from "@/server/modules/inventory/service";
import { getOrganization } from "@/server/modules/organizations/service";
import { can } from "@/server/platform/permissions";

const SOURCE_LINKS: Record<string, (id: string) => string> = {
  purchase_order: (id) => `/purchasing/orders/${id}`,
  sale: (id) => `/sales/${id}`,
};

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; undone?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "inventory.read");
  const [doc, org] = await Promise.all([load(getDocument(ctx, id)), getOrganization(ctx)]);
  const reversible = !doc.reversedBy && !doc.sourceType && ["opening", "receipt", "issue", "adjustment", "transfer"].includes(doc.type) && can(ctx, "inventory.write");
  const total = doc.lines.reduce((a, l) => a + Number(l.totalCost), 0);
  return (
    <>
      <PageHeader
        title={DOC_TYPE_LABELS[doc.type]}
        description={`Comprobante ${doc.number}`}
        back={{ href: "/inventory/movements", label: "historial" }}
        actions={
          reversible && (
            <ConfirmAction
              action={reverseDocumentAction}
              hidden={{ documentId: doc.id }}
              label="Deshacer este movimiento"
              title="¿Deshacer este movimiento?"
              description="Se registra el movimiento contrario (por ejemplo, si entraron 5 unidades, salen 5). Ambos quedan en el historial para que siempre se vea qué pasó."
              confirmLabel="Deshacer"
              requireReason
            />
          )
        }
      />
      {sp.done && (
        <div className="mb-4">
          <Alert tone="success">
            Listo, quedó registrado.{" "}
            <Link href="/inventory/new" className="font-medium underline">
              Hacer otro movimiento
            </Link>{" "}
            ·{" "}
            <Link href="/inventory" className="font-medium underline">
              Ver existencias
            </Link>
          </Alert>
        </div>
      )}
      {sp.undone && (
        <div className="mb-4">
          <Alert tone="success">Movimiento deshecho. Las cantidades volvieron a como estaban.</Alert>
        </div>
      )}
      {doc.reversedBy && (
        <div className="mb-4">
          <Alert tone="warning">
            Este movimiento fue deshecho con{" "}
            <Link href={`/inventory/documents/${doc.reversedBy.id}`} className="font-medium underline">
              {doc.reversedBy.number}
            </Link>
            .
          </Alert>
        </div>
      )}
      <Card title="Datos del documento" className="mb-6">
        <DescriptionList
          items={[
            { label: "Fecha", value: formatDateTime(doc.postedAt, org.timezone) },
            { label: "Hecho por", value: doc.userName },
            { label: "Motivo", value: doc.reason },
            { label: "Notas", value: doc.notes },
            ...(doc.reverses
              ? [
                  {
                    label: "Deshace el movimiento",
                    value: (
                      <Link href={`/inventory/documents/${doc.reverses.id}`} className="text-primary hover:underline">
                        {doc.reverses.number}
                      </Link>
                    ),
                  },
                ]
              : []),
            ...(doc.sourceType && doc.sourceId && SOURCE_LINKS[doc.sourceType]
              ? [
                  {
                    label: "Origen",
                    value: (
                      <Link href={SOURCE_LINKS[doc.sourceType]!(doc.sourceId)} className="text-primary hover:underline">
                        {doc.sourceType === "sale" ? "Ver venta" : "Ver orden de compra"}
                      </Link>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      <Table>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Producto</Th>
            <Th>Bodega</Th>
            <Th align="right">Cantidad</Th>
            <Th align="right">Costo c/u</Th>
            <Th align="right">Valor</Th>
            <Th align="right">Quedaron</Th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.lineNo}>
              <Td className="text-muted">{l.lineNo}</Td>
              <Td>
                {l.productName}
                <span className="block text-xs text-muted">
                  {l.sku}
                  {l.variantName ? ` · ${l.variantName}` : ""}
                </span>
              </Td>
              <Td className="text-muted">
                {l.locationCode === "GENERAL" ? l.warehouseName : `${l.warehouseName} · ${l.locationCode}`}
              </Td>
              <Td align="right" className={Number(l.quantity) < 0 ? "text-danger" : "text-success"}>
                {Number(l.quantity) > 0 ? "+" : ""}
                {formatQty(l.quantity)}
              </Td>
              <Td align="right">{formatMoney(l.unitCost, org.currency)}</Td>
              <Td align="right">{formatMoney(l.totalCost, org.currency)}</Td>
              <Td align="right">{formatQty(l.locationQtyAfter)}</Td>
            </tr>
          ))}
          <tr>
            <Td />
            <Td className="font-semibold">Cambio en el valor del inventario</Td>
            <Td />
            <Td />
            <Td />
            <Td align="right" className="font-semibold">
              {formatMoney(total, org.currency)}
            </Td>
            <Td />
          </tr>
        </tbody>
      </Table>
    </>
  );
}
