// Otorga o retira el rol de ADMINISTRADOR DE PLATAFORMA (operador de InventoryOS, no de una empresa).
// Es la única forma de hacerlo: la aplicación web solo puede leer platform_admins.
//   npm run platform:admin -- --list
//   npm run platform:admin -- --grant persona@dominio.com --note "Soporte"
//   npm run platform:admin -- --revoke persona@dominio.com
// Usa la conexión del dueño del esquema (DATABASE_OWNER_URL, o la de Neon en modo Vercel + Neon).
// Antes de cambiar algo muestra la base de destino (sin contraseña) y la cuenta, y pide escribir el correo
// para confirmar. Solo se audita cuando hay un cambio real.
import { createInterface } from "node:readline";
import pg from "pg";
import { z } from "zod";
import { resolveDatabaseUrls } from "./lib/database-urls.mjs";

const USAGE = "Uso: npm run platform:admin -- --list | --grant <correo> [--note <texto>] | --revoke <correo>";

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

/** Valor de --nombre; falla si falta o si es otra opción (p. ej. "--grant --note x"). */
function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) fail(`Falta el valor de --${name}.\n${USAGE}`);
  return v;
}

const grantArg = option("grant");
const revokeArg = option("revoke");
const list = process.argv.includes("--list");
const note = option("note");
if ([grantArg, revokeArg, list ? "x" : undefined].filter(Boolean).length !== 1) fail(USAGE);
if (note !== undefined && (note.trim().length === 0 || note.length > 200)) fail("La nota debe tener entre 1 y 200 caracteres.");

// Misma validación de correo que la aplicación.
const emailSchema = z.string().trim().toLowerCase().email().max(254);
let email: string | undefined;
if (!list) {
  const parsed = emailSchema.safeParse(grantArg ?? revokeArg);
  if (!parsed.success) fail("Correo inválido. Escribe el correo completo de la cuenta, p. ej. soporte@tu-dominio.com.");
  email = parsed.data;
}

const { ownerUrl, mode } = resolveDatabaseUrls();
if (!ownerUrl) fail("Falta DATABASE_OWNER_URL (dueño del esquema).");

// Destino sin contraseña, para que sea evidente sobre qué base se va a operar.
const target = new URL(ownerUrl);
const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(target.hostname);
const port = target.port || "5432";

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  return new Promise((resolve) => {
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
    // Sin entrada (EOF): se trata como «no confirmado».
    rl.on("close", () => {
      if (!answered) resolve("");
    });
  });
}

const fmt = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "nunca");

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  const { db, role } = (await client.query<{ db: string; role: string }>("select current_database() as db, current_user as role")).rows[0]!;
  console.log("Base de datos de destino:");
  console.log(`  servidor: ${target.hostname}:${port}${isLocal ? "  (LOCAL: este computador)" : ""}`);
  console.log(`  base:     ${db}`);
  console.log(`  usuario:  ${role}`);
  console.log(`  modo:     ${mode === "vercel-neon" ? "Vercel + Neon" : "manual"}`);
  console.log("");

  if (list) {
    const r = await client.query(
      "select u.email, u.name, u.is_active, a.created_at, a.note from platform_admins a join users u on u.id = a.user_id order by a.created_at",
    );
    if (r.rowCount === 0) console.log("No hay administradores de plataforma.");
    for (const row of r.rows) console.log(`${row.email}  ${row.name}  ${row.is_active ? "activa" : "BLOQUEADA"}  desde ${fmt(row.created_at)}  ${row.note ?? ""}`);
  } else {
    const granting = Boolean(grantArg);
    const lookup = () =>
      client.query<{ id: string; name: string; email: string; is_active: boolean; created_at: Date; last_login_at: Date | null; is_admin: boolean }>(
        `select u.id, u.name, u.email, u.is_active, u.created_at, u.last_login_at,
                exists (select 1 from platform_admins a where a.user_id = u.id) as is_admin
         from users u where lower(u.email) = $1`,
        [email],
      );
    const found = await lookup();
    if (found.rowCount === 0) fail(`No existe una cuenta con el correo ${email} en la base ${db}. No se hizo ningún cambio.`);
    const u = found.rows[0]!;
    console.log("Cuenta:");
    console.log(`  nombre:         ${u.name}`);
    console.log(`  correo:         ${u.email}`);
    console.log(`  estado:         ${u.is_active ? "activa" : "BLOQUEADA"}`);
    console.log(`  creada:         ${fmt(u.created_at)}`);
    console.log(`  último ingreso: ${fmt(u.last_login_at)}`);
    console.log(`  administrador de plataforma: ${u.is_admin ? "sí" : "no"}`);
    console.log("");

    // Sin cambio real: no se pide confirmación ni se audita.
    if (granting && u.is_admin) {
      console.log("Ya es administrador de plataforma. No se hizo ningún cambio.");
      process.exit(0);
    }
    if (!granting && !u.is_admin) {
      console.log("No es administrador de plataforma. No se hizo ningún cambio.");
      process.exit(0);
    }
    if (granting && !u.is_active) fail("La cuenta está bloqueada: no puede ser administradora de plataforma.");

    console.log(
      granting
        ? `Vas a OTORGAR privilegios de plataforma (bloquear cuentas, cerrar sesiones y generar enlaces de recuperación de CUALQUIER cuenta) en la base ${db}${isLocal ? " (local)" : ""}.`
        : `Vas a RETIRAR el rol de plataforma en la base ${db}${isLocal ? " (local)" : ""}.`,
    );
    const answer = await ask("Para confirmar, escribe el correo de la cuenta (o deja vacío para cancelar): ");
    if (answer.toLowerCase() !== u.email.toLowerCase()) fail("Cancelado: la confirmación no coincide. No se hizo ningún cambio.");

    await client.query("begin");
    // Se vuelve a leer con bloqueo: el estado pudo cambiar mientras se esperaba la confirmación.
    const locked = await client.query<{ is_active: boolean }>("select is_active from users where id = $1 for update", [u.id]);
    if (locked.rowCount === 0) throw new Error("La cuenta ya no existe. No se hizo ningún cambio.");
    let changed: boolean;
    if (granting) {
      if (!locked.rows[0]!.is_active) throw new Error("La cuenta fue bloqueada mientras tanto. No se hizo ningún cambio.");
      const r = await client.query("insert into platform_admins (user_id, note) values ($1, $2) on conflict do nothing returning user_id", [u.id, note ?? null]);
      changed = r.rowCount === 1;
    } else {
      const r = await client.query("delete from platform_admins where user_id = $1 returning user_id", [u.id]);
      changed = r.rowCount === 1;
    }
    if (changed) {
      await client.query("insert into platform_audit_logs (actor_user_id, action, target_user_id, data) values (null, $1, $2, $3)", [
        granting ? "platform.admin_granted" : "platform.admin_revoked",
        u.id,
        JSON.stringify({ via: "cli", database: db, note: note ?? null, os_user: process.env.USERNAME ?? process.env.USER ?? null }),
      ]);
    }
    await client.query("commit");
    if (!changed) console.log("Otro proceso hizo el mismo cambio mientras tanto. No se hizo ningún cambio.");
    else console.log(granting ? `${u.email} ahora es administrador de plataforma.` : `Se retiró el rol de plataforma a ${u.email}.`);
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
