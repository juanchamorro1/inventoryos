import { FilterBar, Input, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { listAudit } from "@/server/modules/api-keys/service";
import { getOrganization } from "@/server/modules/organizations/service";

export const metadata = { title: "Historial de cambios" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "audit.read");
  const sp = await searchParams;
  const [data, org] = await Promise.all([listAudit(ctx, { action: sp.action, page: Number(sp.page) || 1 }), getOrganization(ctx)]);
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Configuración" }} title="Historial de cambios" description="Registro inmutable de operaciones importantes: quién, qué y cuándo." />
      <FilterBar action="/settings/audit">
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="action">
            Acción (prefijo)
          </label>
          <Input id="action" name="action" defaultValue={sp.action} placeholder="sale, stock, product, member…" />
        </div>
      </FilterBar>
      <Table>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Usuario</Th>
            <Th>Acción</Th>
            <Th>Detalle</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap text-muted">{formatDateTime(r.createdAt, org.timezone)}</Td>
              <Td>{r.userName ?? "Sistema"}</Td>
              <Td className="font-mono text-xs">{r.action}</Td>
              <Td className="max-w-md font-mono text-xs text-muted">
                <span className="block truncate" title={JSON.stringify(r.data)}>
                  {JSON.stringify(r.data)}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/settings/audit" params={sp} />
    </>
  );
}
