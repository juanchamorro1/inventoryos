import { acceptInvitationAction, acceptInvitationNewAccountAction, logoutAction } from "@/app/actions/auth";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Alert, buttonClass, Card, Input, Label, LinkButton } from "@/components/ui";
import { getSession } from "@/server/auth/session";
import { getInvitationByToken, type InvitationView } from "@/server/modules/invitations/service";
import { AppError } from "@/server/platform/errors";
import { ROLE_LABELS } from "@/server/platform/permissions";

export const metadata = { title: "Invitación" };
export const dynamic = "force-dynamic";

const STATE_MESSAGES: Record<Exclude<InvitationView["state"], "valid">, string> = {
  expired: "Esta invitación venció. Pide a la empresa que te envíe una nueva.",
  accepted: "Esta invitación ya fue usada. Si eres tú, inicia sesión normalmente.",
  revoked: "Esta invitación fue anulada por la empresa.",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invitation: InvitationView;
  try {
    invitation = await getInvitationByToken(token);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return (
      <Card title="Invitación no válida">
        <Alert>{err.message}</Alert>
        <LinkButton href="/login" variant="secondary" className="mt-4">
          Ir a iniciar sesión
        </LinkButton>
      </Card>
    );
  }
  const title = `Te invitaron a ${invitation.organizationName}`;
  const subtitle = (
    <p className="mb-4 text-sm text-muted">
      Invitación para <span className="font-medium text-ink">{invitation.email}</span> con el rol <span className="font-medium text-ink">{ROLE_LABELS[invitation.role]}</span>.
    </p>
  );

  if (invitation.state !== "valid") {
    return (
      <Card title={title}>
        <Alert tone="warning">{STATE_MESSAGES[invitation.state]}</Alert>
        <LinkButton href="/login" variant="secondary" className="mt-4">
          Ir a iniciar sesión
        </LinkButton>
      </Card>
    );
  }

  const session = await getSession();
  const next = `/invite/${token}`;

  if (session) {
    if (session.user.email.toLowerCase() !== invitation.email) {
      return (
        <Card title={title}>
          {subtitle}
          <Alert tone="warning">
            Estás conectado como {session.user.email}. Esta invitación es para otra cuenta: cierra sesión e ingresa con {invitation.email}.
          </Alert>
          <form action={logoutAction} className="mt-4">
            <input type="hidden" name="next" value={next} />
            <button type="submit" className={buttonClass("secondary")}>
              Cerrar sesión
            </button>
          </form>
        </Card>
      );
    }
    return (
      <Card title={title}>
        {subtitle}
        <ActionForm action={acceptInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton pendingText="Aceptando…">Aceptar invitación</SubmitButton>
        </ActionForm>
      </Card>
    );
  }

  if (invitation.accountExists) {
    return (
      <Card title={title}>
        {subtitle}
        <p className="mb-4 text-sm">Ya tienes una cuenta con este correo. Inicia sesión y luego acepta la invitación.</p>
        <LinkButton href={`/login?next=${encodeURIComponent(next)}`}>Iniciar sesión para aceptar</LinkButton>
      </Card>
    );
  }

  return (
    <Card title={title}>
      {subtitle}
      <p className="mb-4 text-sm">Crea tu cuenta. La contraseña la eliges tú: nadie de la empresa la conocerá.</p>
      <ActionForm action={acceptInvitationNewAccountAction}>
        <input type="hidden" name="token" value={token} />
        <div>
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" type="email" value={invitation.email} readOnly disabled />
        </div>
        <div>
          <Label htmlFor="name">Tu nombre</Label>
          <Input id="name" name="name" autoComplete="name" required maxLength={120} />
          <FieldError name="name" />
        </div>
        <div>
          <Label htmlFor="password" hint="mínimo 10 caracteres, con letras y números">
            Contraseña
          </Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
          <FieldError name="password" />
        </div>
        <div>
          <Label htmlFor="passwordConfirm">Repite la contraseña</Label>
          <Input id="passwordConfirm" name="passwordConfirm" type="password" autoComplete="new-password" required />
          <FieldError name="passwordConfirm" />
        </div>
        <SubmitButton className="w-full" pendingText="Creando cuenta…">
          Crear cuenta y unirme
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}
