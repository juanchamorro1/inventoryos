import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const migrationsFolder = path.resolve(import.meta.dirname, "..", "..", "drizzle");

export async function runMigrations(ownerUrl: string, opts: { reset?: boolean; appRole?: string } = {}) {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    if (opts.reset) {
      const appRole = opts.appRole ?? "inventoryos_app";
      await pool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
      await pool.query(`DROP SCHEMA IF EXISTS public CASCADE`);
      await pool.query(`CREATE SCHEMA public`);
      await pool.query(`GRANT USAGE ON SCHEMA public TO "${appRole.replaceAll('"', '""')}"`);
    }
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
