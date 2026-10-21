import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "./helpers";

// Reproduce el entorno de Neon: el administrador (neondb_owner) NO es superusuario, pero tiene
// CREATEROLE y es dueño de la base. scripts/db-setup.mjs se ejecuta dos veces, como en dos despliegues.

const run = promisify(execFile);
const script = path.resolve(import.meta.dirname, "..", "..", "scripts", "db-setup.mjs");
const suffix = randomBytes(4).toString("hex");
const simAdmin = `sim_neon_owner_${suffix}`;
const simApp = `sim_inventoryos_app_${suffix}`;
const simDb = `sim_neon_db_${suffix}`;
const adminPassword = randomBytes(18).toString("base64url");

const superUrl = process.env.DATABASE_ADMIN_URL;
const urlFor = (user: string, password: string, db: string) => {
  const u = new URL(superUrl!);
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
};

// Entorno mínimo: sin variables de pruebas ni de Vercel que cambien qué bases toca el script.
function setupEnv(appPassword: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(TEST_DATABASE_|DATABASE_|INVENTORYOS_DB_PASSWORD|POSTGRES_)/.test(k)) delete env[k];
  }
  env.DATABASE_ADMIN_URL = urlFor(simAdmin, adminPassword, simDb);
  env.DATABASE_OWNER_URL = urlFor(simAdmin, adminPassword, simDb);
  env.DATABASE_URL = urlFor(simApp, appPassword, simDb);
  return env;
}

async function superQuery(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: superUrl });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

async function canLogin(user: string, password: string) {
  const c = new pg.Client({ connectionString: urlFor(user, password, simDb) });
  try {
    await c.connect();
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}

describe.skipIf(!superUrl)("db-setup con un administrador sin SUPERUSER (como Neon)", () => {
  beforeAll(async () => {
    await superQuery(`CREATE ROLE "${simAdmin}" LOGIN CREATEROLE CREATEDB NOSUPERUSER NOBYPASSRLS PASSWORD '${adminPassword}'`);
    await superQuery(`CREATE DATABASE "${simDb}" OWNER "${simAdmin}"`);
  });

  afterAll(async () => {
    await superQuery(`DROP DATABASE IF EXISTS "${simDb}" WITH (FORCE)`);
    await superQuery(`DROP ROLE IF EXISTS "${simApp}"`);
    await superQuery(`DROP ROLE IF EXISTS "${simAdmin}"`);
  });

  it("reproduce la causa: ALTER ROLE ... NOSUPERUSER falla sin ser superusuario", async () => {
    const c = new pg.Client({ connectionString: urlFor(simAdmin, adminPassword, simDb) });
    await c.connect();
    const tmp = `sim_tmp_${suffix}`;
    try {
      await c.query(`CREATE ROLE "${tmp}" LOGIN NOSUPERUSER NOBYPASSRLS`);
      const err = await c.query(`ALTER ROLE "${tmp}" LOGIN NOSUPERUSER`).then(
        () => null,
        (e: { code?: string; detail?: string }) => e,
      );
      // Mismo error que en el build de Vercel: 42501 + "Only roles with the SUPERUSER attribute may change the SUPERUSER attribute."
      expect(err?.code).toBe("42501");
      expect(err?.detail).toMatch(/Only roles with the SUPERUSER attribute may change the SUPERUSER attribute/);
    } finally {
      await c.query(`DROP ROLE IF EXISTS "${tmp}"`).catch(() => {});
      await c.end();
    }
  });

  it("primer despliegue crea el rol; el segundo lo actualiza sin error y rota la contraseña", async () => {
    const first = randomBytes(18).toString("base64url");
    const r1 = await run(process.execPath, [script], { env: setupEnv(first) });
    expect(r1.stdout).toContain(`Rol creado: ${simApp}`);

    // Segundo despliegue (antes fallaba con 42501) y con contraseña nueva.
    const second = randomBytes(18).toString("base64url");
    const r2 = await run(process.execPath, [script], { env: setupEnv(second) });
    expect(r2.stdout).toContain(`Rol actualizado: ${simApp}`);
    expect(r2.stdout).toContain("Configuración de base de datos completada.");

    expect(await canLogin(simApp, second)).toBe(true);
    expect(await canLogin(simApp, first)).toBe(false);

    const { rows } = await superQuery("select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = $1", [simApp]);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    // El administrador simulado no fue modificado.
    const admin = await superQuery("select rolsuper, rolcreaterole from pg_roles where rolname = $1", [simAdmin]);
    expect(admin.rows[0]).toEqual({ rolsuper: false, rolcreaterole: true });
  });

  it("se detiene si el rol de la app ya tiene permisos de más", async () => {
    await superQuery(`ALTER ROLE "${simApp}" BYPASSRLS`);
    try {
      const err = await run(process.execPath, [script], { env: setupEnv(randomBytes(18).toString("base64url")) }).then(
        () => null,
        (e: { code?: number; stderr?: string }) => e,
      );
      expect(err?.code).toBe(1);
      expect(err?.stderr).toMatch(/permisos de más/);
    } finally {
      await superQuery(`ALTER ROLE "${simApp}" NOBYPASSRLS`);
    }
  });
});
