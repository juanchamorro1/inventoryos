// Operación de plataforma: asigna el plan comercial de una empresa (no hay pagos integrados).
//   npm run org:plan -- --slug mi-empresa-ab12cd --plan pro
// Usa DATABASE_ADMIN_URL porque actúa fuera del contexto de una empresa.
import pg from "pg";
import { arg } from "./lib/args";

const slug = arg("slug");
const plan = arg("plan");
if (!slug || !plan || !["free", "pro", "enterprise"].includes(plan)) {
  console.error("Uso: npm run org:plan -- --slug <slug> --plan <free|pro|enterprise>");
  process.exit(1);
}
const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("Falta DATABASE_ADMIN_URL.");
  process.exit(1);
}
const u = new URL(url);
u.pathname = new URL(process.env.DATABASE_OWNER_URL ?? url).pathname;
const client = new pg.Client({ connectionString: u.toString() });
await client.connect();
try {
  const r = await client.query("update organizations set plan = $1 where slug = $2 returning name", [plan, slug]);
  if (r.rowCount === 0) {
    console.error(`No existe una empresa con slug ${slug}.`);
    process.exitCode = 1;
  } else console.log(`Plan de ${r.rows[0].name}: ${plan}`);
} finally {
  await client.end();
}
