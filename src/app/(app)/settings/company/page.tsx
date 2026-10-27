import { setBusinessTypeAction, updateOrganizationAction } from "@/app/actions/settings";
import { CurrencySelect } from "@/components/currency-select";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Card, DescriptionList, Input, Label, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";
import { BUSINESS_PROFILES, BUSINESS_TYPES } from "@/server/platform/business-types";
import { can } from "@/server/platform/permissions";

export const metadata = { title: "Configuración de la empresa" };

const fmtLimit = (n: number) => (n === Infinity ? "Ilimitado" : String(n));

export default async function SettingsPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "settings.manage");
  const org = await getOrganization(ctx);
  return (
    <>
      <PageHeader title="Datos de la empresa" back={{ href: "/settings", label: "Configuración" }} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card title="Datos generales">
          <ActionForm action={updateOrganizationAction}>
            <div>
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" name="name" defaultValue={org.name} required maxLength={120} />
              <FieldError name="name" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="currency">
                  Moneda
                </Label>
                <CurrencySelect defaultValue={org.currency} />
                <FieldError name="currency" />
              </div>
              <div>
                <Label htmlFor="timezone">Zona horaria</Label>
                <Input id="timezone" name="timezone" defaultValue={org.timezone} required />
                <FieldError name="timezone" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="lowStockAlerts" defaultChecked={org.settings.lowStockAlerts !== false} /> Mostrar alertas de bajo stock en el panel
            </label>
            <p className="text-xs text-muted">Cambiar la moneda no convierte valores existentes: solo cambia cómo se muestran.</p>
            <SubmitButton>Guardar</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Tipo de negocio">
          <ActionForm action={setBusinessTypeAction}>
            <fieldset className="space-y-2">
              <legend className="sr-only">Tipo de negocio</legend>
              {BUSINESS_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="radio" name="businessType" value={t} defaultChecked={org.businessType === t} className="mt-0.5" />
                  <span>
                    <span className="block font-medium">{BUSINESS_PROFILES[t].label}</span>
                    <span className="block text-xs text-muted">{BUSINESS_PROFILES[t].description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {can(ctx, "pricing.manage") && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="applyPricing" className="mt-0.5 h-4 w-4" />
                <span>Usar también la configuración de precios recomendada (precios automáticos y mayorista apagados).</span>
              </label>
            )}
            <p className="text-xs text-muted">Se crean las categorías habituales que te falten y el formulario de productos pide los datos de tu tipo de negocio. No se borra nada.</p>
            <SubmitButton>Guardar tipo de negocio</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Plan">
          <DescriptionList
            items={[
              { label: "Plan actual", value: org.planInfo.label },
              { label: "Usuarios", value: fmtLimit(org.planInfo.maxUsers) },
              { label: "Bodegas", value: fmtLimit(org.planInfo.maxWarehouses) },
              { label: "Variantes de producto", value: fmtLimit(org.planInfo.maxVariants) },
            ]}
          />
          <p className="mt-4 text-xs text-muted">Los pagos no están integrados en esta versión. El plan lo asigna un operador de la plataforma (ver README).</p>
        </Card>
      </div>
    </>
  );
}
