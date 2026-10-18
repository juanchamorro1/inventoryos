import { randomUUID } from "node:crypto";
import Link from "next/link";
import { postDocumentAction } from "@/app/actions/inventory";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Icon, type IconName } from "@/components/icons";
import { LineItemsEditor } from "@/components/line-items-editor";
import { LocationSelect } from "@/components/location-select";
import { Card, Hint, Input, Label, PageHeader, Textarea } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { listLocationOptions } from "@/server/modules/warehouses/service";

const TYPES = {
  receipt: {
    title: "Ingresar mercancía",
    icon: "plus",
    when: "Llegó mercancía sin un pedido registrado, o estás cargando lo que ya tienes.",
    help: "Las unidades se suman a la bodega elegida. Indica cuánto te costó cada una para calcular bien tus ganancias.",
    place: "¿A qué bodega entra?",
    submit: "Ingresar mercancía",
    reasons: ["Inventario inicial", "Compra sin pedido", "Regalo o muestra del proveedor", "Producción propia"],
  },
  issue: {
    title: "Sacar mercancía",
    icon: "minus",
    when: "Algo se dañó, se perdió, se regaló o se usó en el negocio (no es una venta).",
    help: "Las unidades se restan de la bodega elegida. Para ventas usa siempre «Vender».",
    place: "¿De qué bodega sale?",
    submit: "Sacar mercancía",
    reasons: ["Producto dañado", "Pérdida o robo", "Uso interno", "Regalo a cliente", "Garantía enviada al proveedor"],
  },
  adjustment: {
    title: "Corregir según conteo",
    icon: "clipboard",
    when: "Contaste los productos y el número no coincide con el sistema.",
    help: "Escribe cuántas unidades contaste. El sistema calcula la diferencia y la registra.",
    place: "¿En qué bodega contaste?",
    submit: "Guardar conteo",
    reasons: ["Conteo físico", "Conteo mensual", "Error al registrar"],
  },
  transfer: {
    title: "Mover entre bodegas",
    icon: "arrows",
    when: "Llevas mercancía de una bodega o tienda a otra.",
    help: "Las unidades salen de un lugar y entran al otro al mismo tiempo. Tu total no cambia.",
    place: "",
    submit: "Mover mercancía",
    reasons: ["Surtir tienda", "Devolver a bodega", "Reorganización"],
  },
} as const satisfies Record<string, { title: string; icon: IconName; when: string; help: string; place: string; submit: string; reasons: readonly string[] }>;
type DocType = keyof typeof TYPES;

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const sp = await searchParams;
  return { title: sp.type && sp.type in TYPES ? TYPES[sp.type as DocType].title : "Ajustar inventario" };
}

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "inventory.write");
  const sp = await searchParams;

  if (!sp.type || !(sp.type in TYPES)) {
    return (
      <>
        <PageHeader title="¿Qué necesitas hacer con el inventario?" back={{ href: "/inventory", label: "Inventario" }} />
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(TYPES) as DocType[]).map((k) => (
            <Link key={k} href={`/inventory/new?type=${k}`} className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-5 hover:border-primary">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Icon name={TYPES[k].icon} />
              </span>
              <span>
                <span className="block text-lg font-semibold group-hover:text-primary">{TYPES[k].title}</span>
                <span className="block text-sm text-muted">{TYPES[k].when}</span>
              </span>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">
          ¿Llegó un pedido que le hiciste a un proveedor?{" "}
          <Link href="/purchasing/orders?status=ordered" className="font-medium text-primary hover:underline">
            Recíbelo desde Compras
          </Link>
          . ¿Vendiste algo?{" "}
          <Link href="/sales/new" className="font-medium text-primary hover:underline">
            Regístralo en Vender
          </Link>
          .
        </p>
      </>
    );
  }

  const type = sp.type as DocType;
  const t = TYPES[type];
  const [locations, org] = await Promise.all([listLocationOptions(ctx), getOrganization(ctx)]);
  const secondLocation = locations.find((l) => !(l.isDefault && l.warehouseIsDefault));
  return (
    <>
      <PageHeader title={t.title} description={t.help} back={{ href: "/inventory/new", label: "opciones" }} />
      <Card>
        <ActionForm action={postDocumentAction}>
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          {type === "transfer" ? (
            locations.length < 2 ? (
              <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
                Necesitas al menos dos bodegas o ubicaciones para mover mercancía.{" "}
                <Link href="/warehouses" className="font-medium underline">
                  Crear una bodega
                </Link>
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="fromLocationId">Sale de</Label>
                  <LocationSelect name="fromLocationId" locations={locations} />
                  <FieldError name="fromLocationId" />
                </div>
                <div>
                  <Label htmlFor="toLocationId">Llega a</Label>
                  <LocationSelect name="toLocationId" locations={locations} defaultValue={secondLocation?.id} />
                  <FieldError name="toLocationId" />
                </div>
              </div>
            )
          ) : (
            <div className="max-w-md">
              <Label htmlFor="locationId">{t.place}</Label>
              <LocationSelect name="locationId" locations={locations} />
              <FieldError name="locationId" />
            </div>
          )}
          <div>
            <Label>Productos</Label>
            <LineItemsEditor mode={type} locationField={type === "transfer" ? "fromLocationId" : "locationId"} currency={org.currency} />
            <FieldError name="lines" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="reason">Motivo *</Label>
              <Input id="reason" name="reason" list="reasons" defaultValue={t.reasons[0]} maxLength={300} />
              <datalist id="reasons">
                {t.reasons.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <Hint>Elige uno o escribe el tuyo. Queda guardado en el historial.</Hint>
              <FieldError name="reason" />
            </div>
            <div>
              <Label htmlFor="notes">Comentario (opcional)</Label>
              <Textarea id="notes" name="notes" rows={1} maxLength={2000} className="min-h-10" />
            </div>
          </div>
          <div className="flex justify-end">
            <SubmitButton pendingText="Guardando…">{t.submit}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
