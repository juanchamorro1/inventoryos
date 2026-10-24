import { revokeInvitationAction, updateMemberAction } from "@/app/actions/settings";
import { ConfirmAction } from "@/components/confirm-action";
import { InviteForm } from "@/components/invite-form";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { ROLES } from "@/server/db/schema";
import { INVITATION_TTL_HOURS, listInvitations } from "@/server/modules/invitations/service";
import { getOrganization, listMembers } from "@/server/modules/organizations/service";
import { canAssignRole, ROLE_LABELS } from "@/server/platform/permissions";

export const metadata = { title: "Usuarios y permisos" };

const ROLE_HELP: Record<string, string> = {
  owner: "Control total, incluida la gestión de propietarios.",
  admin: "Control total de la empresa.",
  manager: "Opera catálogo, inventario, compras y ventas; aplica descuentos y anula ventas.",
  staff: "Vende, recibe mercancía y consulta existencias.",
  viewer: "Solo consulta.",
};

export default async function MembersPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "members.manage");
  const [members, invitations, org] = await Promise.all([listMembers(ctx), listInvitations(ctx), getOrganization(ctx)]);
  const reserved = members.length + invitations.filter((i) => !i.expired).length;
  const assignable = ROLES.filter((r) => canAssignRole(ctx.role, r));
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Configuración" }} title="Usuarios y permisos" description={`${reserved} de ${org.planInfo.maxUsers === Infinity ? "ilimitados" : org.planInfo.maxUsers} usuarios del plan ${org.planInfo.label} (incluye invitaciones pendientes).`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Table>
            <thead>
              <tr>
                <Th>Usuario</Th>
                <Th>Último acceso</Th>
                <Th>Rol y estado</Th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const editable = m.userId !== ctx.userId && canAssignRole(ctx.role, m.role);
                return (
                  <tr key={m.userId}>
                    <Td>
                      <span className="font-medium">{m.name}</span> {m.userId === ctx.userId && <Badge>Tú</Badge>}
                      <span className="block text-xs text-muted">{m.email}</span>
                    </Td>
                    <Td className="text-muted">{formatDateTime(m.lastLoginAt, org.timezone)}</Td>
                    <Td>
                      {editable ? (
                        <ActionForm action={updateMemberAction} className="flex flex-wrap items-center gap-2 space-y-0">
                          <input type="hidden" name="userId" value={m.userId} />
                          <Select name="role" defaultValue={m.role} aria-label={`Rol de ${m.name}`} className="h-9 w-auto">
                            {assignable.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </Select>
                          <Select name="status" defaultValue={m.status} aria-label={`Estado de ${m.name}`} className="h-9 w-auto">
                            <option value="active">Activo</option>
                            <option value="disabled">Desactivado</option>
                          </Select>
                          <SubmitButton variant="secondary" className="h-9">
                            Guardar
                          </SubmitButton>
                        </ActionForm>
                      ) : (
                        <span className="flex gap-1">
                          <Badge tone="primary">{ROLE_LABELS[m.role]}</Badge>
                          {m.status === "disabled" && <Badge tone="danger">Desactivado</Badge>}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {invitations.length > 0 && (
            <Card title="Invitaciones pendientes">
              <Table>
                <thead>
                  <tr>
                    <Th>Correo</Th>
                    <Th>Rol</Th>
                    <Th>Vence</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((i) => (
                    <tr key={i.id}>
                      <Td>
                        <span className="font-medium">{i.email}</span>
                        <span className="block text-xs text-muted">Invitada por {i.invitedByName}</span>
                      </Td>
                      <Td>{ROLE_LABELS[i.role]}</Td>
                      <Td className="text-muted">{i.expired ? <Badge tone="danger">Vencida</Badge> : formatDateTime(i.expiresAt, org.timezone)}</Td>
                      <Td align="right">
                        {canAssignRole(ctx.role, i.role) && (
                          <ConfirmAction action={revokeInvitationAction} hidden={{ id: i.id }} label="Anular" size="sm" title={`¿Anular la invitación a ${i.email}?`} description="El enlace dejará de funcionar. Puedes crear una nueva cuando quieras." confirmLabel="Anular" />
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Invitar a una persona">
            <InviteForm roles={assignable.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} hours={INVITATION_TTL_HOURS} />
          </Card>
          <Card title="Roles">
            <ul className="space-y-2 text-sm">
              {ROLES.map((r) => (
                <li key={r}>
                  <span className="font-medium">{ROLE_LABELS[r]}:</span> <span className="text-muted">{ROLE_HELP[r]}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
