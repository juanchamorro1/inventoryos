// Otorga o retira el rol de ADMINISTRADOR DE PLATAFORMA (operador de InventoryOS, no de una empresa).
// Es la única forma de hacerlo: la aplicación web solo puede leer platform_admins.
//   npm run platform:admin -- --list
//   npm run platform:admin -- --grant persona@dominio.com --note "Soporte"
//   npm run platform:admin -- --revoke persona@dominio.com
// Usa la conexión del dueño del esquema (DATABASE_OWNER_URL, o la de Neon en modo Vercel + Neon).
import pg from "pg";
import { arg } from "./lib/args";
import { resolveDatabaseUrls } from "./lib/database-urls.mjs";

const grant = arg("grant");
const revoke = arg("revoke");
const list = process.argv.includes("--list");
if ([grant, revoke, list ? "x" : undefined].filter(Boolean).length !== 1) {
  console.error("Uso: npm run platform:admin -- --list | --grant <correo> [--note <texto>] | --revoke <correo>");
  process.exit(1);
}
const { ownerUrl } = resolveDatabaseUrls();
if (!ownerUrl) {
  console.error("Falta DATABASE_OWNER_URL (dueño del esquema).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  if (list) {
    const r = await client.query(
      "select u.email, u.name, u.is_active, a.created_at, a.note from platform_admins a join users u on u.id = a.user_id order by a.created_at",
    );
    if (r.rowCount === 0) console.log("No hay administradores de plataforma.");
    for (const row of r.rows) console.log(`${row.email}  ${row.name}  ${row.is_active ? "activa" : "BLOQUEADA"}  desde ${row.created_at.toISOString()}  ${row.note ?? ""}`);
  } else {
    const email = (grant ?? revoke)!.trim().toLowerCase();
    await client.query("begin");
    const u = await client.query("select id, is_active from users where lower(email) = $1 for update", [email]);
    if (u.rowCount === 0) throw new Error(`No existe una cuenta con el correo ${email}.`);
    const { id, is_active } = u.rows[0];
    if (grant) {
      if (!is_active) throw new Error("La cuenta está bloqueada: no puede ser administradora de plataforma.");
      const r = await client.query("insert into platform_admins (user_id, note) values ($1, $2) on conflict do nothing returning user_id", [id, arg("note") ?? null]);
      if (r.rowCount === 0) console.log(`${email} ya era administrador de plataforma.`);
      else console.log(`${email} ahora es administrador de plataforma.`);
    } else {
      const r = await client.query("delete from platform_admins where user_id = $1 returning user_id", [id]);
      console.log(r.rowCount === 0 ? `${email} no era administrador de plataforma.` : `Se retiró el rol de plataforma a ${email}.`);
    }
    await client.query(
      "insert into platform_audit_logs (actor_user_id, action, target_user_id, data) values (null, $1, $2, $3)",
      [grant ? "platform.admin_granted" : "platform.admin_revoked", id, JSON.stringify({ via: "cli", os_user: process.env.USERNAME ?? process.env.USER ?? null })],
    );
    await client.query("commit");
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
