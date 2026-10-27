import Link from "next/link";
import { setPricingModesAction } from "@/app/actions/pricing";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, inputClass, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { CLIENT_PRICE_STEPS, getPricingOverview } from "@/server/modules/pricing/service";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "Sistemas de precios" };

function Toggle({ name, title, defaultChecked, on, off }: { name: string; title: string; defaultChecked: boolean; on: string; off: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-4 rounded-xl border border-border p-4 hover:border-primary">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} role="switch" className="peer sr-only" aria-label={title} />
        <span aria-hidden className="h-6 w-11 rounded-full bg-border transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40" />
        <span aria-hidden className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">
          <strong>Encendido:</strong> {on}
        </span>
        <span className="block text-sm text-muted">
          <strong>Apagado:</strong> {off}
        </span>
      </span>
    </label>
  );
}

export default async function PricingModesPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "pricing.manage");
  const { settings } = await getPricingOverview(ctx);
  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Configuración" }}
        title="Sistemas de precios"
        description="Enciende o apaga el cálculo automático de precios, el precio mayorista y el redondeo del precio final. Cambiar esto no modifica ningún precio que ya tengas."
      />
      <Card className="max-w-2xl">
        <ActionForm action={setPricingModesAction}>
          <Toggle
            name="retailAutoEnabled"
            title="Precios automáticos"
            defaultChecked={settings.retailAutoEnabled}
            on="la app calcula el precio con el costo y el margen, y propone cambios cuando cambian el costo o la tasa del dólar."
            off="escribes el precio de cada producto a mano. No hay cálculos ni «cambios pendientes»."
          />
          <Toggle
            name="wholesaleEnabled"
            title="Precio mayorista"
            defaultChecked={settings.wholesaleEnabled}
            on="cada producto puede tener un precio mayorista y una cantidad mínima."
            off="el precio mayorista no se muestra, no se calcula ni se publica. Si lo vuelves a encender, reaparecen los que ya tenías."
          />
          <Toggle
            name="roundClientPrice"
            title="Redondear el precio que paga el cliente"
            defaultChecked={settings.roundClientPrice}
            on="al escribir o calcular un precio, lo que paga el cliente (con IVA) sube al múltiplo elegido. Ej.: 80.110,80 → 80.200."
            off="se guarda exactamente el precio que resulte."
          />
          <div className="max-w-xs">
            <label htmlFor="clientPriceStep" className="mb-1 block text-sm font-medium">
              Redondear a múltiplos de
            </label>
            <select id="clientPriceStep" name="clientPriceStep" defaultValue={String(Number(settings.clientPriceStep))} className={inputClass}>
              {CLIENT_PRICE_STEPS.map((s) => (
                <option key={s} value={s}>
                  {formatMoney(s)}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton>Guardar</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-sm text-muted">
          Los márgenes, el redondeo y la tasa del dólar se configuran en{" "}
          <Link href="/pricing" className="text-primary hover:underline">
            Precios
          </Link>
          .
        </p>
      </Card>
    </>
  );
}
