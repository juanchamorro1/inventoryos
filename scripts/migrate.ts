// Aplica las migraciones de drizzle/ con el rol dueño del esquema.
//   npm run db:migrate              → base principal (DATABASE_OWNER_URL)
//   npm run db:migrate -- --test    → base de pruebas (TEST_DATABASE_OWNER_URL)
//   --reset                         → SOLO con --test: borra y recrea el esquema antes de migrar.
import { runMigrations } from "./lib/migrations";

const isTest = process.argv.includes("--test");
const reset = process.argv.includes("--reset");
const url = isTest ? process.env.TEST_DATABASE_OWNER_URL : process.env.DATABASE_OWNER_URL;

if (!url) {
  console.error(`Falta ${isTest ? "TEST_DATABASE_OWNER_URL" : "DATABASE_OWNER_URL"} (ver .env.example).`);
  process.exit(1);
}
if (reset && !isTest) {
  console.error("--reset solo está permitido junto con --test.");
  process.exit(1);
}

await runMigrations(url, { reset });
console.log(`Migraciones aplicadas en ${new URL(url).pathname.slice(1)}.`);
