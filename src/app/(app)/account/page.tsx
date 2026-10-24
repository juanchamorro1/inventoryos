import { revokeAllMySessionsAction } from "@/app/actions/account";
import { changePasswordAction } from "@/app/actions/auth";
import { ConfirmAction } from "@/components/confirm-action";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Card, Input, Label, LinkButton, PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth/session";
import { isPlatformAdmin } from "@/server/modules/platform/service";

export const metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const { session } = await requireContext();
  const platformAdmin = await isPlatformAdmin(session.user.id);
  return (
    <>
      <PageHeader title="Mi cuenta" description={`${session.user.name} · ${session.user.email}`} />
      <div className="max-w-lg space-y-6">
        <Card title="Cambiar contraseña">
          <ActionForm action={changePasswordAction} resetOnSuccess>
            <div>
              <Label htmlFor="currentPassword">Contraseña actual</Label>
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
              <FieldError name="currentPassword" />
            </div>
            <div>
              <Label htmlFor="newPassword" hint="mínimo 10 caracteres, letras y números">
                Nueva contraseña
              </Label>
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
              <FieldError name="newPassword" />
            </div>
            <div>
              <Label htmlFor="newPasswordConfirm">Confirmar nueva contraseña</Label>
              <Input id="newPasswordConfirm" name="newPasswordConfirm" type="password" autoComplete="new-password" required />
              <FieldError name="newPasswordConfirm" />
            </div>
            <SubmitButton>Cambiar contraseña</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Sesiones abiertas">
          <p className="mb-4 text-sm text-muted">
            «Salir» cierra solo este dispositivo. Si perdiste un celular o crees que alguien más entró a tu cuenta, cierra la sesión en todos los dispositivos y en todas tus empresas.
          </p>
          <ConfirmAction
            action={revokeAllMySessionsAction}
            label="Cerrar sesión en todos los dispositivos"
            title="¿Cerrar sesión en todos los dispositivos?"
            description="Tendrás que volver a ingresar en cada dispositivo, incluido este."
            confirmLabel="Cerrar todas"
          />
        </Card>
        {platformAdmin && (
          <Card title="Administración de la plataforma">
            <LinkButton href="/platform" variant="secondary">
              Abrir herramientas de plataforma
            </LinkButton>
          </Card>
        )}
      </div>
    </>
  );
}
