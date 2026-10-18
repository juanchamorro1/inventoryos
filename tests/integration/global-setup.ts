import { runMigrations } from "../../scripts/lib/migrations";

/** Recrea el esquema de la base de pruebas desde cero y aplica todas las migraciones. */
export default async function setup() {
  const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
  const appUrl = process.env.TEST_DATABASE_URL;
  if (!ownerUrl || !appUrl) {
    throw new Error("Faltan TEST_DATABASE_OWNER_URL y TEST_DATABASE_URL. Ejecuta `npm run db:local:init` o revisa .env.example.");
  }
  if (!new URL(ownerUrl).pathname.endsWith("_test")) {
    throw new Error("Por seguridad, la base de pruebas debe terminar en _test (se borra en cada ejecución).");
  }
  await runMigrations(ownerUrl, { reset: true, appRole: decodeURIComponent(new URL(appUrl).username) });
}
