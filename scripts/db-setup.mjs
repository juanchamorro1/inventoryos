// Crea (de forma idempotente) los roles y las bases de datos de InventoryOS.
// Requiere DATABASE_ADMIN_URL (superusuario, o un rol con CREATEROLE y CREATEDB).
//   inventoryos_owner: dueño del esquema; solo se usa para migraciones.
//   inventoryos_app:   rol de la aplicación; sin BYPASSRLS y sin ser dueño de tablas.
import pg from "pg";
import { resolveDatabaseUrls } from "./lib/database-urls.mjs";

const urls = resolveDatabaseUrls();
for (const [key, value] of [["DATABASE_ADMIN_URL", urls.adminUrl], ["DATABASE_OWNER_URL", urls.ownerUrl], ["DATABASE_URL", urls.appUrl]]) {
  if (!value) {
    console.error(`Falta la variable ${key}. Revisa .env.local (ver .env.example).`);
    process.exit(1);
  }
}

const adminUrl = new URL(urls.adminUrl);
const owner = new URL(urls.ownerUrl);
const app = new URL(urls.appUrl);
const adminRole = decodeURIComponent(adminUrl.username);
const ownerRole = decodeURIComponent(owner.username);
const appRole = decodeURIComponent(app.username);
const databases = [owner.pathname.slice(1)];
if (process.env.TEST_DATABASE_OWNER_URL) databases.push(new URL(process.env.TEST_DATABASE_OWNER_URL).pathname.slice(1));

const ident = (s) => `"${s.replaceAll('"', '""')}"`;
const literal = (s) => `'${s.replaceAll("'", "''")}'`;
const withDatabase = (url, db) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

const admin = new pg.Client({ connectionString: urls.adminUrl });
await admin.connect();
try {
  const roles = [
    // Si el dueño del esquema es el mismo administrador (p. ej. neondb_owner en Neon), no se toca.
    ...(ownerRole === adminRole ? [] : [[ownerRole, owner, "NOSUPERUSER NOCREATEROLE NOBYPASSRLS"]]),
    [appRole, app, "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"],
  ];
  if (appRole === adminRole || appRole === ownerRole) {
    console.error("El usuario de la aplicación debe ser distinto del administrador y del dueño (usa inventoryos_app).");
    process.exit(1);
  }
  for (const [role, url, attrs] of roles) {
    const exists = await admin.query("select 1 from pg_roles where rolname = $1", [role]);
    const verb = exists.rowCount === 0 ? "CREATE" : "ALTER";
    await admin.query(`${verb} ROLE ${ident(role)} LOGIN ${attrs} PASSWORD ${literal(decodeURIComponent(url.password))}`);
    console.log(`Rol ${verb === "CREATE" ? "creado" : "actualizado"}: ${role}`);
  }
  for (const db of databases) {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [db]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${ident(db)} OWNER ${ident(ownerRole)} ENCODING 'UTF8'`);
      console.log(`Base de datos creada: ${db}`);
    }
    await admin.query(`REVOKE ALL ON DATABASE ${ident(db)} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(db)} TO ${ident(appRole)}`);
    await admin.query(`GRANT ALL ON DATABASE ${ident(db)} TO ${ident(ownerRole)}`);
    const dbClient = new pg.Client({ connectionString: withDatabase(urls.adminUrl, db) });
    await dbClient.connect();
    await dbClient.query(`ALTER SCHEMA public OWNER TO ${ident(ownerRole)}`);
    await dbClient.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await dbClient.query(`GRANT USAGE ON SCHEMA public TO ${ident(appRole)}`);
    await dbClient.end();
  }
  console.log("Configuración de base de datos completada.");
} finally {
  await admin.end();
}
