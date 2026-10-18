import Link from "next/link";
import { EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Proveedores" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "purchasing.read");
  const sp = await searchParams;
  const status = sp.status === "archived" ? "archived" : "active";
  const data = await listSuppliers(ctx, { search: sp.q, status, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title="Proveedores" actions={can(ctx, "purchasing.write") && <LinkButton href="/purchasing/suppliers/new">Nuevo proveedor</LinkButton>} />
      <FilterBar action="/purchasing/suppliers">
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-xs text-muted" htmlFor="q">
            Buscar
          </label>
          <Input id="q" name="q" defaultValue={sp.q} placeholder="Nombre, NIT o correo" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="status">
            Estado
          </label>
          <Select id="status" name="status" defaultValue={status}>
            <option value="active">Activos</option>
            <option value="archived">Archivados</option>
          </Select>
        </div>
      </FilterBar>
      {data.rows.length === 0 ? (
        <EmptyState title="No hay proveedores" description="Registra a quién le compras para crear órdenes de compra." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Proveedor</Th>
                <Th>NIT</Th>
                <Th>Contacto</Th>
                <Th align="right">Órdenes abiertas</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/purchasing/suppliers/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                  </Td>
                  <Td className="text-muted">{s.taxId ?? "—"}</Td>
                  <Td className="text-muted">{[s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td align="right">{s.openOrders}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/purchasing/suppliers" params={sp} />
        </>
      )}
    </>
  );
}
