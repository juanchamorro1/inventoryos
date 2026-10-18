import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Input, Label } from "@/components/ui";
import { getSession } from "@/server/auth/session";
import { env } from "@/server/env";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <Card title="Iniciar sesión">
      <ActionForm action={loginAction}>
        <div>
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </div>
        <div>
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <SubmitButton className="w-full" pendingText="Ingresando…">
          Ingresar
        </SubmitButton>
      </ActionForm>
      {env().ALLOW_SIGNUP && (
        <p className="mt-4 text-center text-sm text-muted">
          ¿No tienes cuenta?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Registra tu empresa
          </Link>
        </p>
      )}
    </Card>
  );
}
