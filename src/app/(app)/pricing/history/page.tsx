import Link from "next/link";
import { Badge, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { listPriceHistory } from "@/server/modules/pricing/service";

export const metadata = { title: "Historial de precios" };

const SOURCES: Record<string, string> = { auto: "Automático", approval: "Aprobado", manual: "Manual", revert: "Vuelve a automático", import: "Importación" };

export default async function PriceHistoryPage({ searchParams }: { searchParams: Promise<{ page?: string; product?: string }> }) {
  const { ctx } = await requireContext();
  const sp = await searchParams;
  const productId = sp.product && /^[0-9a-f-]{36}$/i.test(sp.product) ? sp.product : undefined;
  const [data, org] = await Promise.all([listPriceHistory(ctx, { productId, page: Number(sp.page) || 1 }), getOrganization(ctx)]);
  return (
    <>
      <PageHeader title="Historial de precios" back={{ href: "/pricing", label: "Precios y tasas" }} description="Cada cambio de precio publicado: valor anterior, nuevo, quién, cuándo y por qué." />
      {data.rows.length === 0 ? (
        <EmptyState title="Sin cambios registrados" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Producto</Th>
                <Th>Precio</Th>
                <Th align="right">Anterior → nuevo</Th>
                <Th>Origen</Th>
                <Th>Motivo</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((h) => (
                <tr key={h.id}>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(h.createdAt, org.timezone)}</Td>
                  <Td>
                    <Link href={`/products/${h.productId}`} className="font-medium hover:underline">
                      {h.productName}
                    </Link>
                    <span className="block text-xs text-muted">{h.sku}</span>
                  </Td>
                  <Td>{h.kind === "retail" ? "Minorista" : "Mayorista"}</Td>
                  <Td align="right" className="whitespace-nowrap">
                    {h.oldPrice === null ? "—" : formatMoney(h.oldPrice, org.currency)} → {h.newPrice === null ? "—" : formatMoney(h.newPrice, org.currency)}
                    {h.rate && <span className="block text-xs text-muted">Tasa {formatNumber(h.rate, 2)}</span>}
                  </Td>
                  <Td>
                    <Badge tone={h.newMode === "manual" ? "neutral" : "primary"}>{SOURCES[h.source]}</Badge>
                    <span className="block text-xs text-muted">{h.userName ?? "Sistema"}</span>
                  </Td>
                  <Td className="text-muted">{h.reason ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/pricing/history" params={sp} />
        </>
      )}
    </>
  );
}
