import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __inventoryPool?: pg.Pool; __inventoryDb?: Database };

function create() {
  const pool = new pg.Pool({
    connectionString: env().DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    application_name: "inventoryos",
  });
  pool.on("error", (err) => console.error("[db] error en conexión inactiva", err));
  return { pool, db: drizzle(pool, { schema }) };
}

/** Conexión de la aplicación (rol sin BYPASSRLS). Todo acceso a datos de negocio debe pasar por withTenantTx. */
export function getDb(): Database {
  if (!globalForDb.__inventoryDb) {
    const { pool, db } = create();
    globalForDb.__inventoryPool = pool;
    globalForDb.__inventoryDb = db;
  }
  return globalForDb.__inventoryDb;
}

export async function closeDb() {
  await globalForDb.__inventoryPool?.end();
  globalForDb.__inventoryPool = undefined;
  globalForDb.__inventoryDb = undefined;
}
