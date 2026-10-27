import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { profileOf } from "@/server/platform/business-types";
import { can, type Permission } from "@/server/platform/permissions";

export const metadata = { title: "Configuración" };

type Item = { href: string; icon: IconName; title: string; text: string; permission: Permission };

// Lo que casi todos usan; lo técnico queda en «Opciones avanzadas» para no confundir.
const BASIC: Item[] = [
  { href: "/settings/company", icon: "home", title: "Datos de la empresa", text: "Nombre, moneda, tipo de negocio y plan.", permission: "settings.manage" },
  { href: "/settings/members", icon: "users", title: "Usuarios y permisos", text: "Invita a tu equipo y define qué puede hacer cada uno.", permission: "members.manage" },
  { href: "/settings/catalog", icon: "clipboard", title: "Categorías, marcas e impuestos", text: "Para organizar tus productos y calcular el IVA.", permission: "catalog.write" },
  { href: "/products/import", icon: "plus", title: "Importar productos desde Excel", text: "Carga o corrige muchos productos a la vez.", permission: "catalog.write" },
  { href: "/settings/pricing-modes", icon: "receipt", title: "Sistemas de precios", text: "Precios automáticos y precio mayorista: enciéndelos solo si los necesitas.", permission: "pricing.manage" },
];

const ADVANCED: Item[] = [
  { href: "/warehouses", icon: "boxes", title: "Bodegas y ubicaciones", text: "Si tienes varias tiendas, bodegas o estantes.", permission: "inventory.read" },
  { href: "/settings/api-keys", icon: "arrows", title: "Conexión con otros sistemas", text: "Claves para el asistente de WhatsApp u otras integraciones.", permission: "apikeys.manage" },
  { href: "/settings/audit", icon: "receipt", title: "Historial de cambios", text: "Quién hizo qué y cuándo.", permission: "audit.read" },
  { href: "/settings/consistency", icon: "check", title: "Revisar el inventario", text: "Comprueba que las cantidades cuadran con los movimientos.", permission: "inventory.read" },
];

function Grid({ items }: { items: Item[] }) {
  return (
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
  );
}

export default async function SettingsHubPage() {
  const { ctx } = await requireContext();
  const org = await getOrganization(ctx);
  const basic = BASIC.filter((i) => can(ctx, i.permission));
  const advanced = ADVANCED.filter((i) => can(ctx, i.permission));
  return (
    <>
      <PageHeader title="Configuración" description={`${profileOf(org.businessType).label}. Normalmente solo necesitas esto al empezar.`} />
      <Grid items={basic} />
      {advanced.length > 0 && (
        <details className="mt-6 rounded-xl border border-border bg-surface p-4">
          <summary className="cursor-pointer font-semibold">Opciones avanzadas</summary>
          <div className="mt-4">
            <Grid items={advanced} />
          </div>
        </details>
      )}
    </>
  );
}
