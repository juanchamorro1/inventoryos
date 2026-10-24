import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions/account";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Input, Label } from "@/components/ui";

export const metadata = { title: "Recuperar contraseña" };

export default function ForgotPasswordPage() {
  return (
    <Card title="Recuperar contraseña">
      <p className="mb-4 text-sm text-muted">Escribe el correo con el que ingresas. Te enviaremos un enlace para elegir una contraseña nueva.</p>
      <ActionForm action={requestPasswordResetAction} resetOnSuccess>
        <div>
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </div>
        <SubmitButton className="w-full" pendingText="Enviando…">
          Enviar enlace
        </SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </Card>
  );
}
