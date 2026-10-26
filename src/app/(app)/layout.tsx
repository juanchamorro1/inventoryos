import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { Sidebar, type NavItem } from "@/components/sidebar";
import { Badge } from "@/components/ui";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { can, ROLE_LABELS, type Permission } from "@/server/platform/permissions";

// Menú corto con palabras cotidianas. Lo avanzado vive dentro de cada sección o en Configuración.
const NAV: (NavItem & { permission: Permission })[] = [
  { href: "/dashboard", label: "Inicio", icon: "home", permission: "catalog.read" },
  { href: "/sales", label: "Ventas", icon: "receipt", permission: "sales.read", match: ["/sales"] },
  { href: "/products", label: "Productos", icon: "box", permission: "catalog.read" },
  { href: "/pricing", label: "Precios", icon: "receipt", permission: "catalog.read", match: ["/pricing"] },
  { href: "/inventory", label: "Inventario", icon: "boxes", permission: "inventory.read", match: ["/warehouses"] },
  { href: "/purchasing/orders", label: "Compras", icon: "truck", permission: "purchasing.read" },
  { href: "/purchasing/suppliers", label: "Proveedores", icon: "users", permission: "purchasing.read" },
  { href: "/customers", label: "Clientes", icon: "person", permission: "sales.read" },
  { href: "/settings", label: "Configuración", icon: "settings", permission: "inventory.read" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, session } = await requireContext();
  const org = await getOrganization(ctx);
  const items = NAV.filter((n) => can(ctx, n.permission)).map(({ permission: _p, ...rest }) => rest);
  return (
    <div className="lg:flex">
      <Sidebar
        items={items}
        orgName={org.name}
        primary={can(ctx, "sales.write") ? { href: "/sales/new", label: "Vender" } : undefined}
        footer={
          <div className="space-y-2 text-sm">
            <div className="px-2">
              <p className="truncate font-medium">{session.user.name}</p>
              <p className="truncate text-xs text-muted">{session.user.email}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge tone="primary">{ROLE_LABELS[ctx.role]}</Badge>
                {org.isDemo && <Badge tone="warning">Demostración</Badge>}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 text-sm">
              <Link href="/account" className="text-muted hover:text-ink">
                Mi cuenta
              </Link>
              <Link href="/organizations" className="text-muted hover:text-ink">
                Cambiar empresa
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="text-muted hover:text-ink">
                  Salir
                </button>
              </form>
            </div>
          </div>
        }
      />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {org.isDemo && (
          <p className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning">
            Estás en una empresa de demostración: puedes probar todo con tranquilidad, los datos son ficticios.
          </p>
        )}
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
