import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { idempotencyKeys } from "../db/schema";
import { ConflictError } from "./errors";

/**
 * Reserva una clave de idempotencia dentro de la transacción de la operación.
 * - Devuelve null si la clave es nueva: la operación debe continuar y luego llamar a completeIdempotency.
 * - Devuelve el resultId si otra solicitud con la misma clave ya se completó.
 * Si otra transacción con la misma clave está en curso, el INSERT espera a que termine (índice único),
 * de modo que nunca se ejecuta la operación dos veces.
 */
export async function claimIdempotency(tx: Tx, organizationId: string, key: string | undefined, scope: string): Promise<string | null> {
  if (!key) return null;
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ organizationId, key, scope })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted.length > 0) return null;
  const [existing] = await tx
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.organizationId, organizationId), eq(idempotencyKeys.key, key)));
  if (!existing || existing.scope !== scope || !existing.resultId) {
    throw new ConflictError("Esta solicitud ya fue procesada con otros datos. Recarga la página e inténtalo de nuevo.", "idempotency_conflict");
  }
  return existing.resultId;
}

export async function completeIdempotency(tx: Tx, organizationId: string, key: string | undefined, resultId: string) {
  if (!key) return;
  await tx
    .update(idempotencyKeys)
    .set({ resultId })
    .where(and(eq(idempotencyKeys.organizationId, organizationId), eq(idempotencyKeys.key, key)));
}

/** Limpieza de claves antiguas (ejecutar periódicamente). */
export async function purgeIdempotencyKeys(tx: Tx, olderThanDays = 7) {
  await tx.execute(sql`delete from idempotency_keys where created_at < now() - make_interval(days => ${olderThanDays})`);
}
