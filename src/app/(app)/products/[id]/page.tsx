import Link from "next/link";
import { setProductStatusAction } from "@/app/actions/catalog";
import { ConfirmAction } from "@/components/confirm-action";
import { ProductImages } from "@/components/product-images";
import { RateIndicator } from "@/components/rate-indicator";
import { VariantPricing } from "@/components/variant-pricing";
import { Alert, Badge, Card, DescriptionList, LinkButton, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { load } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { listProductImages, MAX_IMAGES_PER_PRODUCT } from "@/server/modules/catalog/images";
import { getProduct } from "@/server/modules/catalog/service";
import { D } from "@/server/platform/decimal";
import { roundPrice } from "@/server/modules/pricing/calc";
import { ensurePricesCurrent, getPricingOverview, listPriceHistory } from "@/server/modules/pricing/service";
import { DOC_TYPE_LABELS, listMovements, stockByVariant } from "@/server/modules/inventory/service";
import { getOrganization } from "@/server/modules/organizations/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Producto" };

const place = (warehouse: string, code: string, name?: string) => (code === "GENERAL" ? warehouse : `${warehouse} · ${name ?? code}`);

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; saved?: string; stock?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requireContext();
  await ensurePricesCurrent(ctx);
  const [p, org, images, overview, history] = await Promise.all([
    load(getProduct(ctx, id)),
    getOrganization(ctx),
    listProductImages(ctx, id),
    getPricingOverview(ctx),
    listPriceHistory(ctx, { productId: id, pageSize: 10 }),
  ]);
  const canPricing = can(ctx, "pricing.manage");
  const step = new D(overview.settings.roundingStep);
  const round = (v: string | null) => (v === null ? null : roundPrice(new D(v), step, overview.settings.roundingMode).toFixed(2));
  const rounded = Object.fromEntries(p.variants.map((v) => [v.id, { retail: round(v.suggestedRetailPrice), wholesale: round(v.suggestedWholesalePrice) }]));
  const canWrite = can(ctx, "catalog.write");
  const canStock = can(ctx, "inventory.read");
  const active = p.variants.filter((v) => v.status === "active");
  const stock = canStock ? await Promise.all(active.map((v) => stockByVariant(ctx, v.id))) : [];
  const movements = canStock ? await Promise.all(active.slice(0, 20).map((v) => listMovements(ctx, { variantId: v.id, pageSize: 10 }))) : [];
  const recent = movements
    .flatMap((m) => m.rows)
    .sort((a, b) => b.id - a.id)
    .slice(0, 10);
  const cur = org.currency;
  const taxRate = Number(p.taxRate ?? 0);
  const multi = active.length > 1;
  const avgOf = (v: (typeof active)[number]) => (Number(v.quantity) > 0 ? Number(v.value) / Number(v.quantity) : Number(v.costPrice));
  // «Ganas por unidad» = lo que paga el cliente (con impuesto) − lo que te cuesta. Se informa aparte cuánto de eso es impuesto.
  const grossOf = (v: (typeof active)[number]) => Number(v.salePrice) * (1 + taxRate / 100);
  const gainOf = (v: (typeof active)[number]) => grossOf(v) - avgOf(v);
  const taxOf = (v: (typeof active)[number]) => grossOf(v) - Number(v.salePrice);
  const totalQty = active.reduce((a, v) => a + Number(v.quantity), 0);
  const one = active[0];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.name} {p.status === "archived" && <Badge tone="warning">Ya no se vende</Badge>}
          </span>
        }
        description={[p.categoryName, p.brandName].filter(Boolean).join(" · ") || undefined}
        back={{ href: "/products", label: "Productos" }}
        actions={
          <>
            {can(ctx, "sales.write") && p.status === "active" && totalQty > 0 && <LinkButton href="/sales/new">Vender</LinkButton>}
            {canWrite && (
              <LinkButton href={`/products/${p.id}/edit`} variant="secondary">
                Editar
              </LinkButton>
            )}
            {can(ctx, "inventory.write") && p.status === "active" && (
              <LinkButton href="/inventory/new?type=adjustment" variant="secondary">
                Corregir cantidad
              </LinkButton>
            )}
            {canWrite &&
              (p.status === "active" ? (
                <ConfirmAction
                  action={setProductStatusAction}
                  hidden={{ productId: p.id, status: "archived" }}
                  label="Dejar de vender"
                  title="¿Dejar de vender este producto?"
                  description="Ya no aparecerá al vender ni al comprar. Su historial se conserva y puedes reactivarlo cuando quieras."
                  confirmLabel="Dejar de vender"
                />
              ) : (
                <ConfirmAction action={setProductStatusAction} hidden={{ productId: p.id, status: "active" }} label="Volver a vender" title="¿Reactivar este producto?" confirmLabel="Reactivar" variant="primary" />
              ))}
          </>
        }
      />

      {sp.created && (
        <div className="mb-6">
          <Alert tone="success">
            Producto guardado.{" "}
            {canWrite && (
              <Link href="/products/new" className="font-medium underline">
                Agregar otro producto
              </Link>
            )}
            {sp.stock === "sin-permiso" && " (Las unidades iniciales no se registraron: tu usuario no tiene permiso para modificar el inventario.)"}
          </Alert>
        </div>
      )}
      {sp.saved && (
        <div className="mb-6">
          <Alert tone="success">Cambios guardados.</Alert>
        </div>
      )}

      {!multi && one && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Precio al cliente" value={formatMoney(Number(one.salePrice) * (1 + taxRate / 100), cur)} hint={`${formatMoney(one.salePrice, cur)} + ${p.taxName ?? "sin impuesto"}`} />
          <Stat label="Te cuesta" value={formatMoney(avgOf(one), cur)} hint={Number(one.quantity) > 0 ? "Promedio de lo que has pagado" : "Costo de referencia"} />
          <Stat
            label="Ganas por unidad"
            value={formatMoney(gainOf(one), cur)}
            hint={
              taxOf(one) > 0
                ? `Precio al cliente − te cuesta. Incluye ${formatMoney(taxOf(one), cur)} de ${p.taxName ?? "impuesto"}; sin impuesto quedan ${formatMoney(Number(one.salePrice) - avgOf(one), cur)}`
                : "Precio al cliente − te cuesta"
            }
            tone={gainOf(one) < 0 ? "danger" : undefined}
          />
          <Stat
            label="Tienes"
            value={`${formatQty(one.quantity)} ${p.unit === "unidad" ? "unid." : p.unit}`}
            hint={Number(one.lowStockThreshold) > 0 ? `Aviso cuando queden ${formatQty(one.lowStockThreshold)}` : "Sin aviso de mínimo"}
            tone={Number(one.quantity) === 0 ? "danger" : Number(one.lowStockThreshold) > 0 && Number(one.quantity) <= Number(one.lowStockThreshold) ? "warning" : undefined}
          />
        </div>
      )}

      {multi && (
        <>
          <h2 className="mb-3 text-lg font-semibold">Presentaciones</h2>
          <Table>
            <thead>
              <tr>
                <Th>Presentación</Th>
                <Th align="right">Precio al cliente</Th>
                <Th align="right">Te cuesta</Th>
                <Th align="right">Ganas</Th>
                <Th align="right">Tienes</Th>
              </tr>
            </thead>
            <tbody>
              {p.variants.map((v) => {
                const qty = Number(v.quantity);
                const avg = qty > 0 ? Number(v.value) / qty : Number(v.costPrice);
                const low = Number(v.lowStockThreshold) > 0 && qty <= Number(v.lowStockThreshold);
                return (
                  <tr key={v.id} className={v.status === "archived" ? "opacity-60" : undefined}>
                    <Td>
                      <span className="font-medium">{v.name || v.sku}</span> {v.status === "archived" && <Badge>Ya no se vende</Badge>}
                      <span className="block text-xs text-muted">Código {v.sku}</span>
                    </Td>
                    <Td align="right">{formatMoney(Number(v.salePrice) * (1 + taxRate / 100), cur)}</Td>
                    <Td align="right">{formatMoney(avg, cur)}</Td>
                    <Td align="right" className={grossOf(v) - avg < 0 ? "text-danger" : undefined}>
                      {formatMoney(grossOf(v) - avg, cur)}
                      {taxOf(v) > 0 && <span className="block text-xs text-muted">incluye {formatMoney(taxOf(v), cur)} de impuesto</span>}
                    </Td>
                    <Td align="right" className={qty === 0 ? "font-semibold text-danger" : low ? "font-semibold text-warning" : undefined}>
                      {qty === 0 ? "Agotado" : formatQty(v.quantity)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {canStock && (
          <Card title="¿Dónde está?">
            {stock.every((s) => s.byLocation.length === 0) ? (
              <p className="text-sm text-muted">No hay unidades en ninguna bodega.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {active.flatMap((v, i) =>
                  (stock[i]?.byLocation ?? []).map((l) => (
                    <li key={`${v.id}-${l.locationId}`} className="flex justify-between gap-3 py-2">
                      <span>
                        {multi && <span className="font-medium">{v.name || v.sku} · </span>}
                        {place(l.warehouseName, l.locationCode, l.locationName)}
                      </span>
                      <span className="num font-medium">{formatQty(l.onHand)}</span>
                    </li>
                  )),
                )}
              </ul>
            )}
          </Card>
        )}
        <Card title="Datos del producto">
          <DescriptionList
            items={[
              { label: "Código interno (SKU)", value: active.map((v) => v.sku).join(", ") || "—" },
              { label: "Código de barras", value: active.map((v) => v.barcode).filter(Boolean).join(", ") || "—" },
              { label: "Código de referencia", value: active.map((v) => v.referenceCode).filter(Boolean).join(", ") || "—" },
              { label: "Proveedor habitual", value: p.supplierName ?? "—" },
              { label: "Impuesto", value: p.taxName ?? "Sin impuesto" },
              { label: "Se vende por", value: p.unit },
              ...Object.entries(p.attributes).map(([k, v]) => ({ label: k, value: v })),
            ]}
          />
          {p.description && <p className="mt-4 whitespace-pre-line text-sm text-muted">{p.description}</p>}
        </Card>
      </div>

      <Card title="Costos y precios" className="mt-6" actions={<Link href="/pricing" className="text-sm text-primary hover:underline">Configurar márgenes y tasa</Link>}>
        {active.some((v) => v.costCurrency === "USD") && (
          <div className="mb-4">
            <RateIndicator rate={overview.rate} compact />
          </div>
        )}
        <VariantPricing
          variants={active}
          currency={cur}
          canManage={canPricing}
          rounded={rounded}
          retailAutoEnabled={overview.settings.retailAutoEnabled}
          wholesaleEnabled={overview.settings.wholesaleEnabled}
        />
      </Card>

      <Card title="Fotos" className="mt-6">
        <ProductImages productId={p.id} productName={p.name} images={images} canWrite={canWrite} max={MAX_IMAGES_PER_PRODUCT} />
      </Card>

      <Card
        title="Historial de precios"
        className="mt-6"
        actions={
          <Link href={`/pricing/history?product=${p.id}`} className="text-sm text-primary hover:underline">
            Ver todo
          </Link>
        }
      >
        {history.rows.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay cambios de precio.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {history.rows.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{h.kind === "retail" ? "Minorista" : "Mayorista"}</span> · {h.sku}: {h.oldPrice === null ? "sin precio" : formatMoney(h.oldPrice, cur)} →{" "}
                  {h.newPrice === null ? "sin precio" : formatMoney(h.newPrice, cur)}
                  <span className="block text-xs text-muted">
                    {formatDateTime(h.createdAt, org.timezone)} · {h.userName ?? "Sistema"} · {h.reason}
                  </span>
                </span>
                <Badge tone={h.newMode === "manual" ? "neutral" : "primary"}>{h.newMode === "manual" ? "Manual" : "Automático"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canStock && (
        <Card
          title="Últimos movimientos"
          className="mt-6"
          actions={
            <Link href={`/inventory/movements?q=${encodeURIComponent(active[0]?.sku ?? "")}`} className="text-sm text-primary hover:underline">
              Ver todo el historial
            </Link>
          }
        >
          {recent.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay entradas ni salidas.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {recent.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <Link href={`/inventory/documents/${m.documentId}`} className="font-medium hover:underline">
                      {DOC_TYPE_LABELS[m.type]}
                    </Link>
                    <span className="text-muted"> · {m.reason}</span>
                    <span className="block text-xs text-muted">
                      {formatDateTime(m.createdAt, org.timezone)} · {m.userName}
                    </span>
                  </span>
                  <span className={Number(m.quantity) < 0 ? "num shrink-0 font-medium text-danger" : "num shrink-0 font-medium text-success"}>
                    {Number(m.quantity) > 0 ? "+" : ""}
                    {formatQty(m.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
