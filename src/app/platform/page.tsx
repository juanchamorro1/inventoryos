import { blockUserAction, revokeUserSessionsAction, unblockUserAction } from "@/app/actions/platform";
import { ConfirmAction } from "@/components/confirm-action";
import { ResetLinkForm } from "@/components/reset-link-form";
import { Alert, Badge, buttonClass, Card, Input, Label, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { load } from "@/server/auth/page";
import { getSession, requestMeta } from "@/server/auth/session";
import { PLATFORM_RESET_TTL_HOURS } from "@/server/modules/auth/recovery";
import {
  findUserByEmail,
  isSessionFresh,
  listAccountEvents,
  PLATFORM_SESSION_MAX_AGE_HOURS,
  requirePlatformAdmin,
  type PlatformUser,
} from "@/server/modules/platform/service";
import { AppError } from "@/server/platform/errors";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  "account.password_reset_requested": "Pidió recuperar la contraseña",
  "account.password_reset": "Restableció la contraseña",
  "account.sessions_revoked": "Cerró todas sus sesiones",
  "platform.user_viewed": "Consulta de plataforma",
  "platform.user_blocked": "Cuenta bloqueada",
  "platform.user_unblocked": "Cuenta desbloqueada",
  "platform.sessions_revoked": "Sesiones cerradas por plataforma",
  "platform.password_reset_link_issued": "Enlace de recuperación generado",
  "platform.admin_granted": "Rol de plataforma otorgado",
  "platform.admin_revoked": "Rol de plataforma retirado",
};

const TZ = "America/Bogota";

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  // La página se renderiza en paralelo con el layout: también aquí quien no es administrador recibe 404.
  const pctx = await load(requirePlatformAdmin(await getSession(), (await requestMeta()).ip));
  const fresh = isSessionFresh(pctx.sessionCreatedAt);

  let user: PlatformUser | null = null;
  let events: Awaited<ReturnType<typeof listAccountEvents>> = [];
  let error: string | null = null;
  if (email && fresh) {
    try {
      user = await findUserByEmail(pctx, email);
      if (user) events = await listAccountEvents(pctx, user.id);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      error = err.message;
    }
  }
  const manageable = user && !user.isPlatformAdmin && user.id !== pctx.userId;

  return (
    <div className="space-y-6">
      {!fresh && (
        <Alert tone="warning">
          Por seguridad, estas herramientas exigen haber iniciado sesión hace menos de {PLATFORM_SESSION_MAX_AGE_HOURS} horas. Sal y vuelve a ingresar.
        </Alert>
      )}
      <Card title="Buscar una cuenta">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="email">Correo exacto</Label>
            <Input id="email" name="email" type="email" defaultValue={email ?? ""} required autoComplete="off" />
          </div>
          <button type="submit" className={buttonClass("primary")} disabled={!fresh}>
            Buscar
          </button>
        </form>
      </Card>
      {error && <Alert>{error}</Alert>}
      {email && fresh && !error && !user && <Alert tone="warning">No hay ninguna cuenta con ese correo.</Alert>}
      {user && (
        <Card title={user.name}>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Correo</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt className="text-muted">Estado</dt>
              <dd className="flex gap-1" data-testid="account-status">
                {user.isActive ? <Badge tone="success">Activa</Badge> : <Badge tone="danger">Bloqueada</Badge>}
                {user.isPlatformAdmin && <Badge tone="primary">Administrador de plataforma</Badge>}
              </dd>
            </div>
            {!user.isActive && (
              <div className="sm:col-span-2">
                <dt className="text-muted">Motivo del bloqueo</dt>
                <dd>
                  {user.blockedReason} ({formatDateTime(user.blockedAt, TZ)})
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted">Creada</dt>
              <dd>{formatDateTime(user.createdAt, TZ)}</dd>
            </div>
            <div>
              <dt className="text-muted">Último ingreso</dt>
              <dd>{user.lastLoginAt ? formatDateTime(user.lastLoginAt, TZ) : "Nunca"}</dd>
            </div>
            <div>
              <dt className="text-muted">Sesiones abiertas</dt>
              <dd data-testid="active-sessions">{user.activeSessions}</dd>
            </div>
          </dl>
          {manageable ? (
            <div className="mt-6 space-y-4">
              <div className="flex flex-wrap gap-2">
                {user.isActive ? (
                  <ConfirmAction
                    action={blockUserAction}
                    hidden={{ userId: user.id }}
                    label="Bloquear cuenta"
                    title={`¿Bloquear la cuenta de ${user.email}?`}
                    description="No podrá ingresar a ninguna empresa, se cierran todas sus sesiones y sus claves API dejan de funcionar."
                    confirmLabel="Bloquear"
                    requireReason
                  />
                ) : (
                  <ConfirmAction action={unblockUserAction} hidden={{ userId: user.id }} label="Desbloquear cuenta" variant="primary" title={`¿Desbloquear la cuenta de ${user.email}?`} confirmLabel="Desbloquear" />
                )}
                <ConfirmAction
                  action={revokeUserSessionsAction}
                  hidden={{ userId: user.id }}
                  label="Cerrar todas sus sesiones"
                  variant="secondary"
                  title="¿Cerrar todas las sesiones de esta cuenta?"
                  description="Tendrá que volver a ingresar en cada dispositivo."
                  confirmLabel="Cerrar sesiones"
                />
              </div>
              {user.isActive && <ResetLinkForm userId={user.id} hours={PLATFORM_RESET_TTL_HOURS} />}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">Las cuentas de administradores de plataforma (incluida la tuya) se gestionan con el script npm run platform:admin.</p>
          )}
        </Card>
      )}
      {user && events.length > 0 && (
        <Card title="Historial de seguridad">
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Evento</Th>
                <Th>Por</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <Td className="text-muted">{formatDateTime(e.createdAt, TZ)}</Td>
                  <Td>{ACTION_LABELS[e.action] ?? e.action}</Td>
                  <Td className="text-muted">{e.actorName ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
