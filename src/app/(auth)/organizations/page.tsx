import { redirect } from "next/navigation";
import { createOrganizationAction, logoutAction, switchOrganizationAction } from "@/app/actions/auth";
import { CurrencySelect } from "@/components/currency-select";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Badge, buttonClass, Card, Input, Label } from "@/components/ui";
import { getSession } from "@/server/auth/session";
import { env } from "@/server/env";
import { listUserOrganizations } from "@/server/modules/auth/service";
import { isPlatformAdmin } from "@/server/modules/platform/service";
import { ROLE_LABELS } from "@/server/platform/permissions";

export const metadata = { title: "Empresas" };

export default async function OrganizationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const orgs = await listUserOrganizations(session.user.id);
  const canCreate = env().ALLOW_SIGNUP || (await isPlatformAdmin(session.user.id));
  return (
    <div className="space-y-4">
      <Card title={`Hola, ${session.user.name}`}>
        {orgs.length === 0 ? (
          <p className="text-sm text-muted">No perteneces a ninguna empresa activa. Crea una o pide a un administrador que te agregue.</p>
        ) : (
          <ul className="space-y-2">
            {orgs.map((o) => (
              <li key={o.id}>
                <form action={switchOrganizationAction} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <input type="hidden" name="organizationId" value={o.id} />
                  <span>
                    <span className="font-medium">{o.name}</span> <Badge>{ROLE_LABELS[o.role]}</Badge> {o.isDemo && <Badge tone="warning">Demo</Badge>}
                  </span>
                  <button type="submit" className={buttonClass("secondary", "sm")}>
                    Entrar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canCreate && (
        <Card title="Crear otra empresa">
          <ActionForm action={createOrganizationAction}>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label htmlFor="name">Nombre</Label>
                <Input id="name" name="name" required />
                <FieldError name="name" />
              </div>
              <div>
                <Label htmlFor="currency">Moneda</Label>
                <CurrencySelect />
                <FieldError name="currency" />
              </div>
            </div>
            <SubmitButton>Crear empresa</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <form action={logoutAction} className="text-center">
        <button type="submit" className={buttonClass("ghost", "sm")}>
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}
