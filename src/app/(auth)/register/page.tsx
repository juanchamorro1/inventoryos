import Link from "next/link";
import { redirect } from "next/navigation";
import { registerAction } from "@/app/actions/auth";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Alert, Card, Input, Label } from "@/components/ui";
import { getSession } from "@/server/auth/session";
import { env } from "@/server/env";

export const metadata = { title: "Registrar empresa" };

export default async function RegisterPage() {
  if (await getSession()) redirect("/dashboard");
  if (!env().ALLOW_SIGNUP) {
    return (
      <Card title="Registro deshabilitado">
        <Alert tone="warning">El registro público está deshabilitado. Pide a un administrador de tu empresa que te agregue.</Alert>
      </Card>
    );
  }
  return (
    <Card title="Registra tu empresa">
      <ActionForm action={registerAction}>
        <div>
          <Label htmlFor="organizationName">Nombre de la empresa</Label>
          <Input id="organizationName" name="organizationName" required />
          <FieldError name="organizationName" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]">
          <div>
            <Label htmlFor="name">Tu nombre</Label>
            <Input id="name" name="name" autoComplete="name" required />
            <FieldError name="name" />
          </div>
          <div>
            <Label htmlFor="currency">Moneda</Label>
            <Input id="currency" name="currency" defaultValue="COP" maxLength={3} required />
            <FieldError name="currency" />
          </div>
        </div>
        <div>
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
          <FieldError name="email" />
        </div>
        <div>
          <Label htmlFor="password" hint="mínimo 10 caracteres, letras y números">
            Contraseña
          </Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
          <FieldError name="password" />
        </div>
        <div>
          <Label htmlFor="passwordConfirm">Confirmar contraseña</Label>
          <Input id="passwordConfirm" name="passwordConfirm" type="password" autoComplete="new-password" required />
          <FieldError name="passwordConfirm" />
        </div>
        <SubmitButton className="w-full" pendingText="Creando cuenta…">
          Crear cuenta
        </SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Inicia sesión
        </Link>
      </p>
    </Card>
  );
}
