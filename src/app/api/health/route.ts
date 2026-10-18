import { NextResponse } from "next/server";
import pg from "pg";
import { env, envProblems } from "@/server/env";

export const dynamic = "force-dynamic";

// Diagnóstico de despliegue. No revela valores secretos: solo nombres de variables y estados.
export async function GET() {
  const config = envProblems();
  let database: string = "sin probar (configuración inválida)";
  let schemaUpToDate: boolean | null = null;
  let rlsSafe: boolean | null = null;
  if (config.length === 0 || !config.some((c) => c.startsWith("DATABASE_URL"))) {
    const client = new pg.Client({ connectionString: env().DATABASE_URL, connectionTimeoutMillis: 8000 });
    try {
      await client.connect();
      const r = await client.query<{ bypass: boolean; superuser: boolean }>("select rolbypassrls as bypass, rolsuper as superuser from pg_roles where rolname = current_user");
      rlsSafe = Boolean(r.rows[0] && !r.rows[0].bypass && !r.rows[0].superuser);
      // stored_files es la tabla de la migración más reciente.
      const m = await client.query<{ ok: boolean }>("select to_regclass('public.stored_files') is not null as ok");
      schemaUpToDate = Boolean(m.rows[0]?.ok);
      database = "ok";
    } catch (err) {
      const code = (err as { code?: string }).code;
      database = `error${code ? ` (${code})` : ""}: ${(err as Error).message.replace(/postgres(ql)?:\/\/[^\s]+/g, "[url]")}`;
    } finally {
      await client.end().catch(() => {});
    }
  }
  const ok = config.length === 0 && database === "ok" && rlsSafe === true && schemaUpToDate === true;
  return NextResponse.json({ ok, config: config.length ? config : "ok", database, schemaUpToDate, rlsSafe }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
