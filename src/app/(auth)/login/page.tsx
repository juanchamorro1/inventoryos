import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Card, Input, Label } from "@/components/ui";
import { getSession } from "@/server/auth/session";
import { env } from "@/server/env";
import { safeNext } from "@/lib/safe-next";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; sessions?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getSession()) redirect(next ?? "/dashboard");
  return (
    <Card title="Iniciar sesión">
      {sp.reset === "1" && (
        <div className="mb-4">
          <Alert tone="success">Contraseña actualizada. Ingresa con tu contraseña nueva.</Alert>
        </div>
      )}
      {sp.sessions === "closed" && (
        <div className="mb-4">
          <Alert tone="success">Cerramos tu sesión en todos los dispositivos.</Alert>
        </div>
      )}
      <ActionForm action={loginAction}>
        {next && <input type="hidden" name="next" value={next} />}
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
      <p className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </p>
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
