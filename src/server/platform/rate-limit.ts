import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withGlobalTx } from "../db/tx";
import { RateLimitError } from "./errors";

// Límite de solicitudes con ventana fija, guardado en PostgreSQL (funciona igual con varias instancias
// serverless, sin dependencias nuevas). La clave se guarda como SHA-256: no se almacenan correos ni IP en claro.

const keyOf = (scope: string, value: string) => createHash("sha256").update(`${scope}:${value}`).digest("hex");

/** Suma un intento y devuelve true si sigue dentro del límite. */
export async function consumeRateLimit(scope: string, value: string, limit: number, windowSeconds: number): Promise<boolean> {
  const key = keyOf(scope, value);
  const n = await withGlobalTx(async (tx) => {
    const r = await tx.execute<{ count: number }>(sql`
      insert into rate_limits (key, window_start, count)
      values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}::int) * ${windowSeconds}::int), 1)
      on conflict (key, window_start) do update set count = rate_limits.count + 1
      returning count`);
    // Depuración ocasional de ventanas viejas para que la tabla no crezca sin límite.
    if (Math.random() < 0.02) await tx.execute(sql`delete from rate_limits where window_start < now() - interval '2 days'`);
    return r.rows[0]!.count;
  });
  return n <= limit;
}

/** Igual que consumeRateLimit, pero lanza RateLimitError (429) al superar el límite. */
export async function enforceRateLimit(scope: string, value: string, limit: number, windowSeconds: number) {
  if (!(await consumeRateLimit(scope, value, limit, windowSeconds))) throw new RateLimitError();
}
