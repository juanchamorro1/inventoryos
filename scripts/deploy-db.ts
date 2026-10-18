// Prepara la base de datos durante el despliegue (Vercel ejecuta `vercel-build`).
//   1. Si hay DATABASE_ADMIN_URL: crea/actualiza los roles (inventoryos_app, sin BYPASSRLS).
//   2. Aplica las migraciones pendientes con DATABASE_OWNER_URL.
//   3. Verifica que DATABASE_URL (la app) NO pueda saltarse Row-Level Security.
// En despliegues de vista previa (VERCEL_ENV=preview) no migra, salvo MIGRATE_ON_PREVIEW=true,
// para no modificar la base de producción desde una rama de prueba.
import pg from "pg";
import { resolveDatabaseUrls } from "./lib/database-urls.mjs";
import { runMigrations } from "./lib/migrations";

const { mode, ownerUrl, appUrl, adminUrl } = resolveDatabaseUrls();

if (process.env.VERCEL_ENV === "preview" && process.env.MIGRATE_ON_PREVIEW !== "true") {
  console.log("[db:deploy] Vista previa: se omiten las migraciones (define MIGRATE_ON_PREVIEW=true para forzarlas).");
  process.exit(0);
}
if (!ownerUrl || !appUrl) {
  console.error(
    "[db:deploy] No hay base de datos configurada. En Vercel: pestaña Storage › crea una base Neon y conéctala al proyecto, " +
      "y agrega la variable INVENTORYOS_DB_PASSWORD (ver docs/deploy-vercel.md).",
  );
  process.exit(1);
}

console.log(`[db:deploy] Modo de conexión: ${mode === "vercel-neon" ? "Vercel + Neon (Storage)" : "manual"}`);
if (adminUrl) {
  console.log("[db:deploy] Configurando roles…");
  await import("./db-setup.mjs");
}

console.log("[db:deploy] Aplicando migraciones…");
await runMigrations(ownerUrl);

// La app debe conectarse con un rol que respete RLS; si no, el aislamiento entre empresas dependería solo del código.
const client = new pg.Client({ connectionString: appUrl });
await client.connect();
try {
  const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; owns: number }>(`
    select r.rolsuper, r.rolbypassrls,
      (select count(*)::int from pg_tables t where t.schemaname = 'public' and t.tableowner = current_user) as owns
    from pg_roles r where r.rolname = current_user`);
  const r = rows[0];
  if (!r || r.rolsuper || r.rolbypassrls || r.owns > 0) {
    console.error(
      "[db:deploy] DATABASE_URL usa un rol que puede saltarse la seguridad entre empresas (superusuario, BYPASSRLS o dueño de tablas). " +
        "Usa el rol inventoryos_app (ver docs/deploy-vercel.md).",
    );
    process.exit(1);
  }
  console.log("[db:deploy] Listo: migraciones aplicadas y rol de la app verificado.");
} finally {
  await client.end();
}
