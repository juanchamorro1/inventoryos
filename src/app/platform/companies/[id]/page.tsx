import Link from "next/link";
import { Alert, Badge, cx, EmptyState, FilterBar, Input, Pagination, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { SALE_TONES } from "@/lib/status-tones";
import { load } from "@/server/auth/page";
import { getSession, requestMeta } from "@/server/auth/session";
import { listProducts } from "@/server/modules/catalog/service";
import { listStock } from "@/server/modules/inventory/service";
import { isSessionFresh, listCompanyAccess, openCompanySupport, PLATFORM_SESSION_MAX_AGE_HOURS, requirePlatformAdmin, SUPPORT_VIEWS, type SupportView } from "@/server/modules/platform/service";
import { listSales, SALE_STATUS_LABELS } from "@/server/modules/sales/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Empresa (solo lectura)" };

const VIEW_LABELS: Record<SupportView, string> = { products: "Productos", stock: "Inventario", sales: "Ventas" };

/** Precio con impuesto (solo para mostrar). */
const gross = (net: string | null, rate: string) => (net === null ? null : Number(net) * (1 + Number(rate) / 100));

// Vista de soporte: SOLO LECTURA. No hay acciones aquí, el contexto tiene rol "viewer" y cada apertura queda auditada.
// No se muestran costos ni valoración: para dar soporte basta con productos, existencias y ventas.
export default async function CompanySupportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; q?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const pctx = await load(requirePlatformAdmin(await getSession(), (await requestMeta()).ip));
  if (!isSessionFresh(pctx.sessionCreatedAt)) {
    return <Alert tone="warning">Por seguridad, ver los datos de una empresa exige haber iniciado sesión hace menos de {PLATFORM_SESSION_MAX_AGE_HOURS} horas. Sal y vuelve a ingresar.</Alert>;
  }
  const view: SupportView = (SUPPORT_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as SupportView) : "products";
  const { ctx, company } = await load(openCompanySupport(pctx, id, view));
  const page = Number(sp.page) || 1;
  const basePath = `/platform/companies/${company.id}`;
  const access = await listCompanyAccess(pctx, company.id);
  const money = (v: string | number | null) => formatMoney(v, company.currency);
  const section = view === "products" ? await renderProducts() : view === "stock" ? await renderStock() : await renderSales();

  return (
    <div className="space-y-5">
      <div>
        <Link href="/platform" className="text-sm text-muted hover:text-ink">
          ← Todas las empresas
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{company.name}</h1>
      </div>
      <Alert tone="warning">Modo soporte, solo lectura: no puedes cambiar nada de esta empresa. Cada consulta queda registrada con tu nombre.</Alert>

      <nav aria-label="Secciones" className="flex flex-wrap gap-2">
        {SUPPORT_VIEWS.map((v) => (
          <Link key={v} href={`${basePath}?view=${v}`} aria-current={v === view ? "page" : undefined} className={cx("rounded-full border px-3 py-1 text-sm", v === view ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface hover:border-primary")}>
            {VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>

      <FilterBar action={basePath} clear={!!sp.q}>
        <input type="hidden" name="view" value={view} />
        <div className="min-w-64 flex-1">
          <Input name="q" type="search" defaultValue={sp.q ?? ""} placeholder={view === "sales" ? "Número o cliente" : "Nombre o referencia"} aria-label="Buscar" />
        </div>
      </FilterBar>

      {section}

      {access.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted">Últimas consultas de soporte</h2>
          <ul className="space-y-1 text-sm text-muted">
            {access.map((a) => (
              <li key={a.id}>
                {formatDateTime(a.createdAt, company.timezone)} · {a.actorName ?? "—"} · {VIEW_LABELS[(a.data as { view: SupportView }).view]}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  async function renderProducts() {
    const data = await listProducts(ctx, { search: sp.q, page, pageSize: 25 });
    if (data.total === 0) return <EmptyState title="Sin productos" />;
    return (
      <>
        <Table>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th>Marca</Th>
              <Th>Categoría</Th>
              <Th align="right">Precio con IVA</Th>
              <Th align="right">Existencias</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((p) => (
              <tr key={p.id}>
                <Td>
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-muted">{p.skus}</span>
                </Td>
                <Td className="text-muted">{p.brandName ?? "—"}</Td>
                <Td className="text-muted">{p.categoryName ?? "—"}</Td>
                <Td align="right" className="num">{money(gross(p.minPrice, p.taxRate))}</Td>
                <Td align="right" className="num">{formatQty(p.quantity)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath={basePath} params={{ view, q: sp.q }} />
      </>
    );
  }

  async function renderStock() {
    const data = await listStock(ctx, { search: sp.q, page, pageSize: 25 });
    if (data.total === 0) return <EmptyState title="Sin existencias registradas" />;
    return (
      <>
        <Table>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th>Referencia</Th>
              <Th align="right">Existencias</Th>
              <Th align="right">Mínimo</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.variantId}>
                <Td>
                  <span className="font-medium">{r.productName}</span>
                  {r.variantName && <span className="block text-xs text-muted">{r.variantName}</span>}
                </Td>
                <Td className="text-muted">{r.sku}</Td>
                <Td align="right" className="num">{formatQty(r.quantity)}</Td>
                <Td align="right" className="num">{formatQty(r.lowStockThreshold)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath={basePath} params={{ view, q: sp.q }} />
      </>
    );
  }

  async function renderSales() {
    const data = await listSales(ctx, { search: sp.q, page, pageSize: 25 });
    if (data.total === 0) return <EmptyState title="Sin ventas" />;
    return (
      <>
        <Table>
          <thead>
            <tr>
              <Th>Venta</Th>
              <Th>Fecha</Th>
              <Th>Cliente</Th>
              <Th>Estado</Th>
              <Th align="right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium">{s.number}</Td>
                <Td className="text-muted">{formatDateTime(s.createdAt, company.timezone)}</Td>
                <Td className="text-muted">{s.customerName ?? "—"}</Td>
                <Td>
                  <Badge tone={SALE_TONES[s.status]}>{SALE_STATUS_LABELS[s.status]}</Badge>
                </Td>
                <Td align="right" className="num">{money(s.total)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath={basePath} params={{ view, q: sp.q }} />
      </>
    );
  }
}
