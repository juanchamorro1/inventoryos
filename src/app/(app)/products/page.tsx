import Link from "next/link";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { formatMoney, formatQty } from "@/lib/format";
import { requireContext } from "@/server/auth/session";
import { listBrands, listCategories, listProducts } from "@/server/modules/catalog/service";
import { getOrganization } from "@/server/modules/organizations/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Productos" };

type SP = { q?: string; category?: string; brand?: string; status?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ctx } = await requireContext();
  const sp = await searchParams;
  const status = sp.status === "archived" ? "archived" : "active";
  const [data, categories, brands, org] = await Promise.all([
    listProducts(ctx, { search: sp.q, categoryId: sp.category || undefined, brandId: sp.brand || undefined, status, page: Number(sp.page) || 1 }),
    listCategories(ctx),
    listBrands(ctx),
    getOrganization(ctx),
  ]);
  const canWrite = can(ctx, "catalog.write");
  const filtered = Boolean(sp.q || sp.category || sp.brand || status === "archived");
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
      <FilterBar action="/products" clear={filtered}>
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-xs text-muted" htmlFor="q">
            Buscar producto
          </label>
          <Input id="q" name="q" defaultValue={sp.q} placeholder="Nombre, código o código de barras" />
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
          <label className="mb-1 block text-xs text-muted" htmlFor="status">
            Mostrar
          </label>
          <Select id="status" name="status" defaultValue={status}>
            <option value="active">Los que vendo</option>
            <option value="archived">Los que ya no vendo</option>
          </Select>
        </div>
      </FilterBar>

      {data.rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No encontramos productos con esa búsqueda" : "Aún no tienes productos"}
          description={filtered ? "Revisa lo que escribiste o pulsa «Limpiar»." : "Agrega tu primer producto. Solo necesitas el nombre y el precio."}
          action={canWrite && !filtered ? <LinkButton href="/products/new">Agregar producto</LinkButton> : undefined}
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th>Categoría</Th>
                <Th align="right">Precio (sin impuesto)</Th>
                <Th align="right">Tienes</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id} className="hover:bg-bg/50">
                  <Td>
                    <Link href={`/products/${p.id}`} className="flex items-center gap-3 hover:underline">
                      {p.imagePath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/files/${p.imagePath}`} alt="" className="h-10 w-10 rounded-md border border-border object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-xs text-muted">{p.name.slice(0, 2).toUpperCase()}</span>
                      )}
                      <span>
                        <span className="font-medium">{p.name}</span>
                        <span className="block text-xs text-muted">{p.variantCount > 1 ? `${p.variantCount} presentaciones` : `Código ${p.skus}`}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td className="text-muted">{[p.categoryName, p.brandName].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td align="right">
                    {p.minPrice === null ? "—" : p.minPrice === p.maxPrice ? formatMoney(p.minPrice, org.currency) : `desde ${formatMoney(p.minPrice, org.currency)}`}
                  </Td>
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
