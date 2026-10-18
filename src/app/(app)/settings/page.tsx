import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth/session";
import { can, type Permission } from "@/server/platform/permissions";

export const metadata = { title: "Configuración" };

const ITEMS: { href: string; icon: IconName; title: string; text: string; permission: Permission }[] = [
  { href: "/settings/company", icon: "home", title: "Datos de la empresa", text: "Nombre, moneda, zona horaria y plan.", permission: "settings.manage" },
  { href: "/settings/members", icon: "users", title: "Usuarios y permisos", text: "Agrega empleados y define qué puede hacer cada uno.", permission: "members.manage" },
  { href: "/settings/catalog", icon: "clipboard", title: "Categorías, marcas e impuestos", text: "Para organizar tus productos y calcular el IVA.", permission: "catalog.write" },
  { href: "/warehouses", icon: "boxes", title: "Bodegas y ubicaciones", text: "Tus tiendas, bodegas y estantes.", permission: "inventory.read" },
  { href: "/products/import", icon: "plus", title: "Importar productos desde Excel", text: "Carga muchos productos a la vez con un archivo CSV.", permission: "catalog.write" },
  { href: "/settings/api-keys", icon: "arrows", title: "Conexión con otros sistemas", text: "Claves para el asistente de WhatsApp u otras integraciones.", permission: "apikeys.manage" },
  { href: "/settings/audit", icon: "receipt", title: "Historial de cambios", text: "Quién hizo qué y cuándo.", permission: "audit.read" },
  { href: "/settings/consistency", icon: "check", title: "Revisar el inventario", text: "Comprueba que las cantidades cuadran con los movimientos.", permission: "inventory.read" },
];

export default async function SettingsHubPage() {
  const { ctx } = await requireContext();
  const items = ITEMS.filter((i) => can(ctx, i.permission));
  return (
    <>
      <PageHeader title="Configuración" description="Ajustes de tu empresa. Normalmente solo los necesitas al empezar." />
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 hover:border-primary">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg text-muted group-hover:text-primary">
              <Icon name={i.icon} />
            </span>
            <span>
              <span className="block font-semibold group-hover:text-primary">{i.title}</span>
              <span className="block text-sm text-muted">{i.text}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
