import Link from "next/link";
import { approveChangesAction } from "@/app/actions/pricing";
import { ActionForm, SubmitButton } from "@/components/form";
import { RateIndicator } from "@/components/rate-indicator";
import { Alert, Badge, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { formatMoney, formatPercent } from "@/lib/format";
import { requireContext } from "@/server/auth/session";
import { ensurePricesCurrent, getPricingOverview, listPendingChanges } from "@/server/modules/pricing/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Cambios de precio pendientes" };
export const dynamic = "force-dynamic";

const diff = (a: string | null, b: string) => (a === null || Number(a) === 0 ? null : ((Number(b) - Number(a)) / Number(a)) * 100);

export default async function PriceChangesPage({ searchParams }: { searchParams: Promise<{ page?: string; published?: string; variants?: string }> }) {
  const { ctx } = await requireContext();
  const sp = await searchParams;
  await ensurePricesCurrent(ctx);
  const [data, overview] = await Promise.all([listPendingChanges(ctx, { page: Number(sp.page) || 1 }), getPricingOverview(ctx)]);
  const canManage = can(ctx, "pricing.manage");
  const cur = "COP";
  return (
    <>
      <PageHeader
        title="Cambios de precio pendientes"
        back={{ href: "/pricing", label: "Precios y tasas" }}
        description={
          data.policy === "approval"
            ? "Precios automáticos que cambiarían con la tasa, los costos o los márgenes actuales. Nada cambia hasta que los apruebes."
            : "La política actual publica los cambios automáticos al instante; aquí solo aparecen los que no se pudieron aplicar."
        }
      />
      {sp.published !== undefined && (
        <div className="mb-4">
          <Alert tone="success">
            {Number(sp.published) > 0 ? `Se publicaron ${Number(sp.published)} precios en ${Number(sp.variants) || 0} productos.` : "No había cambios pendientes por aprobar."}
          </Alert>
        </div>
      )}
      <div className="mb-4">
        <RateIndicator rate={overview.rate} compact />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="No hay cambios pendientes" description="Todos los precios automáticos coinciden con su valor calculado." />
      ) : (
        <ActionForm action={approveChangesAction}>
          <Table>
            <thead>
              <tr>
                {canManage && (
                  <Th>
                    <span className="sr-only">Seleccionar</span>
                  </Th>
                )}
                <Th>Producto</Th>
                <Th align="right">Minorista actual → nuevo</Th>
                <Th align="right">Mayorista actual → nuevo</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const dr = diff(r.retailCurrent, r.retailNew);
                const dw = diff(r.wholesaleCurrent, r.wholesaleNew);
                return (
                  <tr key={r.variantId}>
                    {canManage && (
                      <Td>
                        <input type="checkbox" name="variantId" value={r.variantId} defaultChecked aria-label={`Aprobar ${r.sku}`} className="h-4 w-4" />
                      </Td>
                    )}
                    <Td>
                      <Link href={`/products/${r.productId}`} className="font-medium hover:underline">
                        {r.productName}
                      </Link>
                      <span className="block text-xs text-muted">
                        {r.variantName ? `${r.variantName} · ` : ""}
                        {r.sku} · costo en {r.costCurrency}
                      </span>
                    </Td>
                    <Td align="right">
                      {r.retailChanges ? (
                        <>
                          {formatMoney(r.retailCurrent, cur)} → <strong>{formatMoney(r.retailNew, cur)}</strong>
                          {dr !== null && <span className="block text-xs text-muted">{dr > 0 ? "+" : ""}{formatPercent(dr.toFixed(2))}</span>}
                        </>
                      ) : (
                        <span className="text-muted">{r.retailMode === "manual" ? "Manual (sin cambio)" : "Sin cambio"}</span>
                      )}
                    </Td>
                    <Td align="right">
                      {r.wholesaleChanges ? (
                        <>
                          {r.wholesaleCurrent === null ? "Sin precio" : formatMoney(r.wholesaleCurrent, cur)} → <strong>{formatMoney(r.wholesaleNew, cur)}</strong>
                          {dw !== null && <span className="block text-xs text-muted">{dw > 0 ? "+" : ""}{formatPercent(dw.toFixed(2))}</span>}
                          {r.wholesaleBelowCost && <Badge tone="danger">Bajo el costo</Badge>}
                        </>
                      ) : (
                        <span className="text-muted">{r.wholesaleMode === "manual" ? "Manual (sin cambio)" : "Sin cambio"}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/pricing/changes" params={sp} />
          {canManage ? (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
              <div className="min-w-64 flex-1">
                <label htmlFor="reason" className="mb-1 block text-sm font-medium">
                  Nota (opcional, queda en el historial)
                </label>
                <input id="reason" name="reason" maxLength={300} className="block h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" />
              </div>
              <SubmitButton pendingText="Publicando…">Aprobar los seleccionados</SubmitButton>
              <button type="submit" name="all" value="1" className="h-10 rounded-lg border border-border px-4 text-sm font-medium hover:bg-bg">
                Aprobar todos ({data.total})
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">Solo un propietario, administrador o gerente puede aprobar cambios de precio.</p>
          )}
        </ActionForm>
      )}
    </>
  );
}
