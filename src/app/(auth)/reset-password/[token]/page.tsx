import { resetPasswordAction } from "@/app/actions/account";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Alert, Card, Input, Label, LinkButton } from "@/components/ui";
import { INVALID_RESET_LINK, isResetTokenValid } from "@/server/modules/auth/recovery";

export const metadata = { title: "Nueva contraseña" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await isResetTokenValid(token))) {
    return (
      <Card title="Enlace no válido">
        <Alert tone="warning">{INVALID_RESET_LINK}</Alert>
        <LinkButton href="/forgot-password" variant="secondary" className="mt-4">
          Solicitar un enlace nuevo
        </LinkButton>
      </Card>
    );
  }
  return (
    <Card title="Elige una contraseña nueva">
      <p className="mb-4 text-sm text-muted">Al guardarla se cerrarán todas tus sesiones abiertas, en todos los dispositivos.</p>
      <ActionForm action={resetPasswordAction}>
        <input type="hidden" name="token" value={token} />
        <div>
          <Label htmlFor="password" hint="mínimo 10 caracteres, con letras y números">
            Contraseña nueva
          </Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus />
          <FieldError name="password" />
        </div>
        <div>
          <Label htmlFor="passwordConfirm">Repite la contraseña</Label>
          <Input id="passwordConfirm" name="passwordConfirm" type="password" autoComplete="new-password" required />
          <FieldError name="passwordConfirm" />
        </div>
        <SubmitButton className="w-full" pendingText="Guardando…">
          Guardar contraseña
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}
