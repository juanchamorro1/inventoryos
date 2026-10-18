import "server-only";
import { sql } from "drizzle-orm";
import type { TenantContext } from "../platform/context";
import { pgError } from "../platform/errors";
import { getDb, type Tx } from "./client";

const RETRYABLE = new Set(["40001", "40P01"]); // serialization_failure, deadlock_detected

async function runWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = pgError(err)?.code;
      if (!code || !RETRYABLE.has(code) || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 20 * 2 ** attempt + Math.random() * 20));
    }
  }
}

/**
 * Ejecuta fn en una transacción con el contexto de empresa fijado SOLO para esa transacción
 * (set_config(..., true) equivale a SET LOCAL). Las políticas RLS filtran por app.org_id; si no
 * está fijado, las consultas no devuelven filas.
 */
export function withTenantTx<T>(ctx: Pick<TenantContext, "organizationId" | "userId">, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithRetry(() =>
    getDb().transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.org_id', ${ctx.organizationId}, true), set_config('app.user_id', ${ctx.userId}, true), set_config('lock_timeout', '5s', true), set_config('statement_timeout', '30s', true)`,
      );
      return fn(tx);
    }),
  );
}

/** Transacción con solo el usuario fijado: permite leer sus membresías y empresas (antes de elegir empresa). */
export function withUserTx<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/** Transacción sin contexto de empresa: solo para tablas globales (users, sessions, login_attempts). */
export function withGlobalTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}

/** Fija una variable de contexto adicional dentro de la transacción actual. */
export async function setTxSetting(tx: Tx, key: "app.org_id" | "app.user_id" | "app.api_key_hash", value: string) {
  await tx.execute(sql`select set_config(${key}, ${value}, true)`);
}
