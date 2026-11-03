import Link from "next/link";
import { archiveCompanyAction, blockUserAction, joinCompanySupportAction, leaveCompanySupportAction, restoreCompanyAction, revokeUserSessionsAction, unblockUserAction } from "@/app/actions/platform";
import { ConfirmAction } from "@/components/confirm-action";
import { CURRENCIES } from "@/components/currency-select";
import { ChangeOwnerButton, CreateCompanyForm, ReissueOwnerButton } from "@/components/platform-companies";
import { PlanSelect } from "@/components/platform-plan-select";
import { ResetLinkForm } from "@/components/reset-link-form";
import { Alert, Badge, buttonClass, Card, Input, Label, Stat, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { load } from "@/server/auth/page";
import { getSession, requestMeta } from "@/server/auth/session";
import { PLATFORM_RESET_TTL_HOURS } from "@/server/modules/auth/recovery";
import { BUSINESS_PROFILES, BUSINESS_TYPES } from "@/server/platform/business-types";
import {
  findUserByEmail,
  isSessionFresh,
  listAccountEvents,
  listAllCompanies,
  PLATFORM_SESSION_MAX_AGE_HOURS,
  requirePlatformAdmin,
  type PlatformUser,
} from "@/server/modules/platform/service";
import { summarizeCompanies } from "@/server/modules/platform/overview";
import { AppError } from "@/server/platform/errors";
import { PLANS } from "@/server/platform/plans";

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
const PLAN_OPTIONS = Object.entries(PLANS).map(([value, p]) => ({ value, label: p.label }));

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
  const allCompanies = fresh ? await listAllCompanies(pctx) : [];
  const companies = allCompanies.filter((c) => !c.archivedAt);
  const archived = allCompanies.filter((c) => c.archivedAt);
  const overview = summarizeCompanies(companies);

  return (
    <div className="space-y-6">
      {!fresh && (
        <Alert tone="warning">
          Por seguridad, estas herramientas exigen haber iniciado sesión hace menos de {PLATFORM_SESSION_MAX_AGE_HOURS} horas. Sal y vuelve a ingresar.
        </Alert>
      )}
      {fresh && (
        <section aria-label="Resumen" className="space-y-3">
          <h1 className="text-xl font-semibold">Tu negocio</h1>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Empresas" value={overview.companies} hint={`${overview.new30d} nuevas en 30 días${overview.demos ? ` · ${overview.demos} de demostración aparte` : ""}`} />
            <Stat label="De pago" value={overview.paying} tone="success" hint={`${overview.free} en plan Gratis`} />
            <Stat
              label="Ingreso mensual estimado"
              value={formatMoney(overview.monthlyIncome, "COP")}
              hint={`Según el plan asignado, no cobros reales${overview.withoutPrice ? ` · ${overview.withoutPrice} sin precio definido` : ""}`}
            />
            <Stat label="Activas en 30 días" value={overview.active30d} hint={`de ${overview.companies}, con algún ingreso`} />
            <Stat label="Usuarios" value={overview.users} />
            <Stat label="Productos" value={overview.products} />
            <Stat label="Ventas en 30 días" value={overview.sales30d} hint="Sin anuladas" />
            <Stat label="Requieren atención" value={overview.attention.length} tone={overview.attention.length ? "warning" : undefined} hint={overview.attention.length ? "Ver la lista abajo" : "Todo en orden"} />
          </div>
        </section>
      )}
      {overview.attention.length > 0 && (
        <Card title="Requieren atención">
          <ul className="space-y-2 text-sm">
            {overview.attention.map((a) => (
              <li key={`${a.organizationId}-${a.reason}`} className="flex flex-wrap items-center gap-2">
                <Badge tone={a.tone}>{a.tone === "danger" ? "Urgente" : "Revisar"}</Badge>
                <Link href={`/platform/companies/${a.organizationId}`} className="font-medium text-primary hover:underline">
                  {a.name}
                </Link>
                <span className="text-muted">{a.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {companies.length > 0 && (
        <Card title={`Empresas (${companies.length})`}>
          <Table>
            <thead>
              <tr>
                <Th>Empresa</Th>
                <Th>Dueño</Th>
                <Th>Estado</Th>
                <Th>Plan</Th>
                <Th>Último ingreso</Th>
                <Th align="right">Productos</Th>
                <Th align="right">Ventas 30 días</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.organizationId}>
                  <Td>
                    <Link href={`/platform/companies/${c.organizationId}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                    <span className="block text-xs text-muted">
                      {BUSINESS_PROFILES[c.businessType].label}{c.isDemo ? " · Demostración" : ""} · Creada {formatDateTime(c.createdAt, TZ)}
                    </span>
                  </Td>
                  <Td className="text-muted">
                    {c.ownerEmail ?? "—"}
                    {c.members > 0 && c.pendingOwnerEmail && <span className="block text-xs text-warning">Cambio pendiente: {c.pendingOwnerEmail}</span>}
                  </Td>
                  <Td>{c.members > 0 ? <Badge tone="success">Activa · {c.members} usuarios</Badge> : c.ownerPending ? <Badge tone="warning">Esperando al dueño</Badge> : <Badge tone="danger">Enlace vencido</Badge>}</Td>
                  <Td>
                    <PlanSelect organizationId={c.organizationId} companyName={c.name} plan={c.plan} options={PLAN_OPTIONS} />
                  </Td>
                  <Td className="text-muted">{c.lastLoginAt ? formatDateTime(c.lastLoginAt, TZ) : "Nunca"}</Td>
                  <Td align="right" className="num">{c.products}</Td>
                  <Td align="right" className="num">{c.sales30d}</Td>
                  <Td align="right">
                    <div className="flex flex-col items-end gap-2">
                      {c.members === 0 && <ReissueOwnerButton organizationId={c.organizationId} />}
                      {c.members > 0 && <ChangeOwnerButton organizationId={c.organizationId} companyName={c.name} ownerEmail={c.ownerEmail} />}
                      {c.access !== "member" && (
                        <ConfirmAction
                          action={joinCompanySupportAction}
                          hidden={{ organizationId: c.organizationId }}
                          label={c.access === "support" ? "Volver a entrar" : "Entrar a ayudar"}
                          size="sm"
                          variant="secondary"
                          title={`¿Entrar a ${c.name} para ayudar?`}
                          description="Entrarás como Administrador y podrás editar todo. El cliente te verá en sus usuarios como «Soporte de InventoryOS», puede desactivarte, y tu entrada y tus cambios quedan registrados."
                          confirmLabel="Entrar"
                          requireReason
                        />
                      )}
                      {c.access === "support" && (
                        <ConfirmAction
                          action={leaveCompanySupportAction}
                          hidden={{ organizationId: c.organizationId }}
                          label="Salir de esta empresa"
                          size="sm"
                          variant="secondary"
                          title={`¿Salir de ${c.name}?`}
                          description="Dejarás de aparecer en sus usuarios. Lo que hiciste se conserva."
                          confirmLabel="Salir"
                        />
                      )}
                      <ConfirmAction
                        action={archiveCompanyAction}
                        hidden={{ organizationId: c.organizationId }}
                        label="Eliminar"
                        size="sm"
                        title={`¿Eliminar ${c.name}?`}
                        description={
                          <>
                            {c.otherMembers > 0 ? <p className="mb-2 font-medium text-danger">Esta empresa tiene {c.otherMembers} usuario(s) además de ti: perderán el acceso.</p> : <p className="mb-2">Solo estás tú en esta empresa.</p>}
                            <p>
                              Tiene {c.products} productos y {c.sales30d} ventas en 30 días. Nadie podrá entrar y, si tiene tienda web, dejará de mostrar el catálogo. Los datos se conservan y puedes restaurarla.
                            </p>
                          </>
                        }
                        confirmLabel="Eliminar empresa"
                        requireReason={c.otherMembers > 0}
                        confirmText={c.otherMembers > 0 ? c.name : undefined}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {archived.length > 0 && (
        <Card title={`Empresas eliminadas (${archived.length})`}>
          <ul className="space-y-2 text-sm">
            {archived.map((c) => (
              <li key={c.organizationId} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted"> · Eliminada {formatDateTime(c.archivedAt, TZ)} · {c.products} productos</span>
                </span>
                <ConfirmAction
                  action={restoreCompanyAction}
                  hidden={{ organizationId: c.organizationId }}
                  label="Restaurar"
                  size="sm"
                  variant="secondary"
                  title={`¿Restaurar ${c.name}?`}
                  description="Sus usuarios vuelven a tener acceso y su tienda web vuelve a mostrar el catálogo."
                  confirmLabel="Restaurar"
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Crear una empresa">
        {fresh ? (
          <CreateCompanyForm
            types={BUSINESS_TYPES.map((t) => ({ value: t, label: BUSINESS_PROFILES[t].label, description: BUSINESS_PROFILES[t].description }))}
            currencies={CURRENCIES.map((c) => c.code)}
          />
        ) : (
          <p className="text-sm text-muted">Vuelve a iniciar sesión para crear empresas.</p>
        )}
      </Card>
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
