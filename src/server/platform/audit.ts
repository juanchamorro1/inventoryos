import type { Tx } from "../db/client";
import { auditLogs } from "../db/schema";
import type { TenantContext } from "./context";

/** Registra una operación importante en la misma transacción que la operación. */
export async function audit(
  tx: Tx,
  ctx: TenantContext,
  action: string,
  entity: { type: string; id?: string | null },
  data: Record<string, unknown> = {},
) {
  await tx.insert(auditLogs).values({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    actorApiKeyId: ctx.actor.type === "api_key" ? ctx.actor.apiKeyId : null,
    action,
    entityType: entity.type,
    entityId: entity.id ?? null,
    data,
  });
}
