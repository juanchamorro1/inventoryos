import { changePasswordAction } from "@/app/actions/auth";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Card, Input, Label, PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth/session";

export const metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const { session } = await requireContext();
  return (
    <>
      <PageHeader title="Mi cuenta" description={`${session.user.name} · ${session.user.email}`} />
      <Card title="Cambiar contraseña" className="max-w-lg">
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
    </>
  );
}
