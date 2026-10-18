import { updateOrganizationAction } from "@/app/actions/settings";
import { CurrencySelect } from "@/components/currency-select";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Card, DescriptionList, Input, Label, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { getOrganization } from "@/server/modules/organizations/service";

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
