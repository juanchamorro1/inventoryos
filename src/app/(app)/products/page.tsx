import Link from "next/link";
import { RateIndicator } from "@/components/rate-indicator";
import { Badge, cx, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { formatMoney, formatQty } from "@/lib/format";
import { requireContext } from "@/server/auth/session";
import { listBrands, listCategories, listProducts, type PricingFilter, type ProductSort } from "@/server/modules/catalog/service";
import { getOrganization } from "@/server/modules/organizations/service";
import { ensurePricesCurrent, getPricingOverview } from "@/server/modules/pricing/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Productos" };

type SP = { q?: string; category?: string; brand?: string; status?: string; currency?: string; pricing?: string; sort?: string; view?: string; page?: string };

const SORTS: Record<ProductSort, string> = { name: "Nombre (A-Z)", price_asc: "Precio: menor a mayor", price_desc: "Precio: mayor a menor", updated: "Editados recientemente", created: "Agregados recientemente" };
const PRICING: Record<PricingFilter, string> = { manual: "Con precio manual", pending: "Con cambio pendiente", no_rate: "Sin tasa válida", below_cost: "Precio bajo el costo" };

function Thumb({ id, name, size = "h-10 w-10" }: { id: string | null; name: string; size?: string }) {
  return id ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/images/${id}`} alt="" loading="lazy" className={cx(size, "shrink-0 rounded-md border border-border object-cover")} />
  ) : (
    <span className={cx(size, "flex shrink-0 items-center justify-center rounded-md border border-border bg-bg text-xs text-muted")}>{name.slice(0, 2).toUpperCase()}</span>
  );
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ctx } = await requireContext();
  const sp = await searchParams;
  // Una TRM nueva se refleja al abrir el catálogo (según la política de la empresa).
  await ensurePricesCurrent(ctx);
  const status = sp.status === "archived" ? "archived" : "active";
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "name") as ProductSort;
  const pricing = sp.pricing && sp.pricing in PRICING ? (sp.pricing as PricingFilter) : undefined;
  const currency = sp.currency === "USD" || sp.currency === "COP" ? sp.currency : undefined;
  const grid = sp.view === "grid";
  const [data, categories, brands, org, overview] = await Promise.all([
    listProducts(ctx, { search: sp.q, categoryId: sp.category || undefined, brandId: sp.brand || undefined, status, currency, pricing, sort, page: Number(sp.page) || 1, pageSize: grid ? 24 : 25 }),
    listCategories(ctx),
    listBrands(ctx),
    getOrganization(ctx),
    getPricingOverview(ctx),
  ]);
  const canWrite = can(ctx, "catalog.write");
  const filtered = Boolean(sp.q || sp.category || sp.brand || status === "archived" || currency || pricing);
  const viewHref = (view: "list" | "grid") => `/products?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "view" && k !== "page")), view }).toString()}`;
  return (
    <>
      <PageHeader
        title="Productos"
        description="Todo lo que vendes, con su precio y cuántas unidades tienes."
        actions={
          <>
            {canWrite && (
              <LinkButton href="/products/import" variant="secondary">
                Importar desde Excel
              </LinkButton>
            )}
            {/* Descarga desde un route handler: no es una página. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/products/export" className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-bg">
              Descargar lista
            </a>
            {canWrite && <LinkButton href="/products/new">Agregar producto</LinkButton>}
          </>
        }
      />
      {(overview.counts.usd > 0 || overview.rate.status !== "ok") && overview.rate.status !== "unsupported" && (
        <div className="mb-4">
          <RateIndicator rate={overview.rate} />
        </div>
      )}
      {overview.counts.pending > 0 && (
        <p className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
          Hay {overview.counts.pending} productos con un precio nuevo pendiente de aprobación.{" "}
          <Link href="/pricing/changes" className="font-medium text-primary hover:underline">
            Revisar cambios
          </Link>
        </p>
      )}
      <FilterBar action="/products" clear={filtered}>
        <input type="hidden" name="view" value={grid ? "grid" : "list"} />
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-xs text-muted" htmlFor="q">
            Buscar producto
          </label>
          <Input id="q" name="q" defaultValue={sp.q} placeholder="Nombre, SKU, código de barras o de referencia" />
        </div>
        {categories.length > 0 && (
          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor="category">
              Categoría
            </label>
            <Select id="category" name="category" defaultValue={sp.category ?? ""}>
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {brands.length > 0 && (
          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor="brand">
              Marca
            </label>
            <Select id="brand" name="brand" defaultValue={sp.brand ?? ""}>
              <option value="">Todas</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="currency">
            Moneda del costo
          </label>
          <Select id="currency" name="currency" defaultValue={currency ?? ""}>
            <option value="">Todas</option>
            <option value="COP">COP</option>
            <option value="USD">USD</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="pricing">
            Precios
          </label>
          <Select id="pricing" name="pricing" defaultValue={pricing ?? ""}>
            <option value="">Todos</option>
            {Object.entries(PRICING).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="status">
            Mostrar
          </label>
          <Select id="status" name="status" defaultValue={status}>
            <option value="active">Los que vendo</option>
            <option value="archived">Los que ya no vendo</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="sort">
            Ordenar por
          </label>
          <Select id="sort" name="sort" defaultValue={sort}>
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      <div className="mb-3 flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">{data.total === 1 ? "1 producto" : `${data.total} productos`}</span>
        <span className="inline-flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Vista">
          <Link href={viewHref("list")} aria-current={!grid ? "page" : undefined} className={cx("px-3 py-1.5", !grid ? "bg-primary text-white" : "hover:bg-bg")}>
            Lista
          </Link>
          <Link href={viewHref("grid")} aria-current={grid ? "page" : undefined} className={cx("px-3 py-1.5", grid ? "bg-primary text-white" : "hover:bg-bg")}>
            Cuadrícula
          </Link>
        </span>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No encontramos productos con esa búsqueda" : "Aún no tienes productos"}
          description={filtered ? "Revisa lo que escribiste o pulsa «Limpiar»." : "Agrega tu primer producto. Solo necesitas el nombre y el costo o el precio."}
          action={canWrite && !filtered ? <LinkButton href="/products/new">Agregar producto</LinkButton> : undefined}
        />
      ) : grid ? (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Productos">
            {data.rows.map((p) => (
              <li key={p.id}>
                <Link href={`/products/${p.id}`} className="block h-full rounded-xl border border-border bg-surface p-3 hover:border-primary">
                  <Thumb id={p.primaryImageId} name={p.name} size="aspect-square w-full" />
                  <span className="mt-2 block font-medium leading-snug">{p.name}</span>
                  <span className="block text-xs text-muted">{p.variantCount > 1 ? `${p.variantCount} presentaciones` : p.skus}</span>
                  <span className="mt-1 block text-sm font-semibold">{p.minPrice === null ? "—" : formatMoney(p.minPrice, org.currency)}</span>
                  {overview.settings.wholesaleEnabled && p.minWholesale && <span className="block text-xs text-muted">Mayorista {formatMoney(p.minWholesale, org.currency)}</span>}
                  <span className="mt-1 flex flex-wrap gap-1">
                    {p.currencies.includes("USD") && <Badge tone="primary">USD</Badge>}
                    {p.manualCount > 0 && <Badge>Manual</Badge>}
                    {p.noRateCount > 0 && <Badge tone="warning">Sin tasa</Badge>}
                    {Number(p.quantity) === 0 && <Badge tone="danger">Agotado</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/products" params={sp} />
        </>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th>Categoría</Th>
                <Th align="right">Precio (sin impuesto)</Th>
                {overview.settings.wholesaleEnabled && <Th align="right">Mayorista</Th>}
                <Th align="right">Tienes</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id} className="hover:bg-bg/50">
                  <Td>
                    <Link href={`/products/${p.id}`} className="flex items-center gap-3 hover:underline">
                      <Thumb id={p.primaryImageId} name={p.name} />
                      <span>
                        <span className="font-medium">{p.name}</span>
                        <span className="block text-xs text-muted">{p.variantCount > 1 ? `${p.variantCount} presentaciones` : `Código ${p.skus}`}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {p.currencies.includes("USD") && <Badge tone="primary">Costo en USD</Badge>}
                          {p.manualCount > 0 && <Badge>Precio manual</Badge>}
                          {p.noRateCount > 0 && <Badge tone="warning">Sin tasa válida</Badge>}
                        </span>
                      </span>
                    </Link>
                  </Td>
                  <Td className="text-muted">{[p.categoryName, p.brandName].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td align="right">
                    {p.minPrice === null ? "—" : p.minPrice === p.maxPrice ? formatMoney(p.minPrice, org.currency) : `desde ${formatMoney(p.minPrice, org.currency)}`}
                  </Td>
                  {overview.settings.wholesaleEnabled && (
                    <Td align="right" className="text-muted">
                      {p.minWholesale ? formatMoney(p.minWholesale, org.currency) : "—"}
                    </Td>
                  )}
                  <Td align="right">{Number(p.quantity) === 0 ? <Badge tone="danger">Agotado</Badge> : formatQty(p.quantity)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/products" params={sp} />
        </>
      )}
    </>
  );
}
