import { revokeApiKeyAction } from "@/app/actions/settings";
import { ApiKeyForm } from "@/components/api-key-form";
import { ConfirmAction } from "@/components/confirm-action";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requirePagePermission } from "@/server/auth/page";
import { requireContext } from "@/server/auth/session";
import { listApiKeys } from "@/server/modules/api-keys/service";
import { getOrganization } from "@/server/modules/organizations/service";
import { env } from "@/server/env";

export const metadata = { title: "Conexión con otros sistemas" };

export default async function ApiKeysPage() {
  const { ctx } = await requireContext();
  requirePagePermission(ctx, "apikeys.manage");
  const [keys, org] = await Promise.all([listApiKeys(ctx), getOrganization(ctx)]);
  const base = env().APP_URL;
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Configuración" }} title="Conexión con otros sistemas" description="Para integraciones como el asistente comercial de WhatsApp. Acceso de solo lectura al catálogo y la disponibilidad de esta empresa." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Table>
            <thead>
              <tr>
                <Th>Nombre</Th>
                <Th>Prefijo</Th>
                <Th>Permisos</Th>
                <Th>Último uso</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 && (
                <tr>
                  <Td className="text-muted">Aún no hay claves.</Td>
                </tr>
              )}
              {keys.map((k) => (
                <tr key={k.id}>
                  <Td>
                    <span className="font-medium">{k.name}</span>
                    <span className="block text-xs text-muted">
                      Creada {formatDateTime(k.createdAt, org.timezone)} por {k.createdByName}
                    </span>
                  </Td>
                  <Td className="font-mono text-xs">ios_{k.prefix}_…</Td>
                  <Td className="text-xs">{k.scopes.join(", ")}</Td>
                  <Td className="text-muted">{k.lastUsedAt ? formatDateTime(k.lastUsedAt, org.timezone) : "Nunca"}</Td>
                  <Td align="right">
                    {k.revokedAt ? (
                      <Badge tone="danger">Revocada</Badge>
                    ) : (
                      <ConfirmAction action={revokeApiKeyAction} hidden={{ id: k.id }} label="Revocar" size="sm" title={`¿Revocar «${k.name}»?`} description="Las integraciones que la usen dejarán de funcionar de inmediato." confirmLabel="Revocar" />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Card title="Uso">
            <div className="space-y-2 text-sm">
              <p>Envía la clave en la cabecera <code>Authorization: Bearer ios_…</code>. Endpoints disponibles (JSON):</p>
              <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
                <li>GET {base}/api/v1/products?q=iphone&amp;page=1&amp;limit=20</li>
                <li>GET {base}/api/v1/products/&#123;sku&#125;</li>
                <li>GET {base}/api/v1/openapi.json</li>
              </ul>
              <p className="text-muted">Las respuestas incluyen precio sin y con impuesto y, si la clave lo permite, existencias por bodega.</p>
            </div>
          </Card>
        </div>
        <Card title="Nueva clave">
          <ApiKeyForm />
        </Card>
      </div>
    </>
  );
}
