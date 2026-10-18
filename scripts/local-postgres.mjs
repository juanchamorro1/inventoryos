// Gestiona un clúster PostgreSQL local del proyecto (alternativa a Docker).
// Usa los binarios de una instalación nativa de PostgreSQL (PG_BIN) y guarda
// los datos en .local/pgdata. No toca ningún servicio PostgreSQL existente.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, ".local", "pgdata");
const logFile = path.join(root, ".local", "postgres.log");
const port = process.env.LOCAL_PG_PORT ?? "5433";
const pgBin =
  process.env.PG_BIN ??
  (process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\17\\bin" : "/usr/lib/postgresql/17/bin");
const exe = (name) => path.join(pgBin, process.platform === "win32" ? `${name}.exe` : name);

const command = process.argv[2];

function secret() {
  return randomBytes(24).toString("base64url");
}

function init() {
  if (!existsSync(exe("initdb"))) {
    console.error(`No se encontró initdb en ${pgBin}. Define PG_BIN con la carpeta bin de PostgreSQL 16+.`);
    process.exit(1);
  }
  if (existsSync(dataDir)) {
    console.log(`El clúster ya existe en ${dataDir}.`);
    return;
  }
  const envFile = path.join(root, ".env.local");
  if (existsSync(envFile)) {
    console.error(".env.local ya existe; no se sobrescribe. Muévelo o ajústalo manualmente antes de inicializar.");
    process.exit(1);
  }
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const adminPassword = secret();
  const pwFile = path.join(root, ".local", "pwfile.tmp");
  writeFileSync(pwFile, adminPassword, { mode: 0o600 });
  try {
    execFileSync(
      exe("initdb"),
      ["-D", dataDir, "-U", "inventoryos_admin", "--pwfile", pwFile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"],
      { stdio: "inherit" },
    );
  } finally {
    rmSync(pwFile, { force: true });
  }
  const ownerPassword = secret();
  const appPassword = secret();
  const host = `127.0.0.1:${port}`;
  writeFileSync(
    envFile,
    [
      "# Generado por scripts/local-postgres.mjs. Contiene secretos locales: no lo subas al repositorio.",
      `DATABASE_ADMIN_URL=postgres://inventoryos_admin:${adminPassword}@${host}/postgres`,
      `DATABASE_OWNER_URL=postgres://inventoryos_owner:${ownerPassword}@${host}/inventoryos`,
      `DATABASE_URL=postgres://inventoryos_app:${appPassword}@${host}/inventoryos`,
      `TEST_DATABASE_OWNER_URL=postgres://inventoryos_owner:${ownerPassword}@${host}/inventoryos_test`,
      `TEST_DATABASE_URL=postgres://inventoryos_app:${appPassword}@${host}/inventoryos_test`,
      "APP_URL=http://localhost:3100",
      "STORAGE_DIR=./storage",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log("Clúster inicializado y .env.local creado. Siguiente: npm run db:local:start && npm run db:setup");
}

function run(args, stdio = "inherit") {
  const r = spawnSync(exe("pg_ctl"), args, { stdio });
  return r.status ?? 1;
}

function start() {
  // El servidor hereda los descriptores de pg_ctl; con "ignore" la terminal no queda esperando.
  const code = run(["-D", dataDir, "-l", logFile, "-o", `-p ${port} -c listen_addresses=127.0.0.1`, "-w", "start"], "ignore");
  if (code !== 0) {
    console.error(`No se pudo iniciar PostgreSQL. Revisa ${logFile}`);
    process.exit(code);
  }
  console.log(`PostgreSQL local escuchando en 127.0.0.1:${port}`);
}

const commands = {
  init,
  start,
  stop: () => process.exit(run(["-D", dataDir, "-m", "fast", "stop"])),
  status: () => process.exit(run(["-D", dataDir, "status"])),
};

if (!commands[command]) {
  console.error("Uso: node scripts/local-postgres.mjs <init|start|stop|status>");
  process.exit(1);
}
commands[command]();
