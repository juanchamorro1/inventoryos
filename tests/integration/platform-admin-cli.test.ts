import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { isPlatformAdmin } from "@/server/modules/platform/service";
import { createOrg } from "./helpers";

// Ejecuta el script real (como `npm run platform:admin`) contra la base de pruebas, escribiendo la confirmación por stdin.

const script = path.resolve(import.meta.dirname, "..", "..", "scripts", "platform-admin.ts");
const ownerUrl = process.env.TEST_DATABASE_OWNER_URL!;

function cli(args: string[], stdin?: string): Promise<{ code: number | null; out: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Solo la conexión indicada: sin variables que cambien el modo o el destino.
  for (const k of Object.keys(env)) if (/^(TEST_DATABASE_|DATABASE_|INVENTORYOS_DB_PASSWORD|POSTGRES_)/.test(k)) delete env[k];
  env.DATABASE_OWNER_URL = ownerUrl;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script, ...args], { env, cwd: path.resolve(import.meta.dirname, "..", "..") });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function owner<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

const auditCount = async (userId: string) =>
  Number((await owner<{ n: string }>("select count(*) as n from platform_audit_logs where target_user_id = $1 and action like 'platform.admin_%'", [userId]))[0]!.n);

describe("script platform:admin", () => {
  it("muestra la base de destino y la cuenta sin revelar la contraseña de la conexión", async () => {
    const org = await createOrg("CLI destino");
    const r = await cli(["--grant", org.email], "");
    const password = decodeURIComponent(new URL(ownerUrl).password);
    expect(r.out).toContain(`base:     ${new URL(ownerUrl).pathname.slice(1)}`);
    expect(r.out).toContain("(LOCAL: este computador)");
    expect(r.out).toContain("nombre:         Dueño");
    expect(r.out).toContain(`correo:         ${org.email}`);
    expect(r.out).not.toContain(password);
    expect(r.out).not.toContain(ownerUrl);
  });

  it("sin confirmación, o con una distinta, no otorga nada ni audita", async () => {
    const org = await createOrg("CLI cancelar");
    for (const answer of ["", "si\n", "otro@test.local\n", `${org.email}x\n`]) {
      const r = await cli(["--grant", org.email], answer);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/Cancelado/);
    }
    expect(await isPlatformAdmin(org.owner.userId)).toBe(false);
    expect(await auditCount(org.owner.userId)).toBe(0);
  });

  it("con la confirmación correcta otorga una vez; repetirlo no cambia nada ni vuelve a auditar", async () => {
    const org = await createOrg("CLI otorgar");
    const r = await cli(["--grant", org.email.toUpperCase(), "--note", "Soporte"], `${org.email.toUpperCase()}\n`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ahora es administrador de plataforma");
    expect(await isPlatformAdmin(org.owner.userId)).toBe(true);
    expect(await auditCount(org.owner.userId)).toBe(1);
    const [log] = await owner<{ data: Record<string, unknown>; actor_user_id: string | null }>(
      "select data, actor_user_id from platform_audit_logs where target_user_id = $1 and action = 'platform.admin_granted'",
      [org.owner.userId],
    );
    expect(log).toMatchObject({ actor_user_id: null, data: { via: "cli", note: "Soporte", database: new URL(ownerUrl).pathname.slice(1) } });

    const again = await cli(["--grant", org.email]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("Ya es administrador de plataforma. No se hizo ningún cambio.");
    expect(await auditCount(org.owner.userId)).toBe(1);
  });

  it("retirar pide confirmación, audita una vez y repetirlo es inocuo", async () => {
    const org = await createOrg("CLI retirar");
    await cli(["--grant", org.email], `${org.email}\n`);
    const cancelled = await cli(["--revoke", org.email], "\n");
    expect(cancelled.code).toBe(1);
    expect(await isPlatformAdmin(org.owner.userId)).toBe(true);

    const r = await cli(["--revoke", org.email], `${org.email}\n`);
    expect(r.code).toBe(0);
    expect(await isPlatformAdmin(org.owner.userId)).toBe(false);
    expect(await auditCount(org.owner.userId)).toBe(2);

    const again = await cli(["--revoke", org.email]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("No es administrador de plataforma. No se hizo ningún cambio.");
    expect(await auditCount(org.owner.userId)).toBe(2);
  });

  it("rechaza correos inválidos, cuentas inexistentes, cuentas bloqueadas y argumentos incompletos", async () => {
    for (const bad of ["no-es-correo", "a@b", " ", "x@y.z,otro@y.z"]) {
      const r = await cli(["--grant", bad], "\n");
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/Correo inválido/);
    }
    const missing = await cli(["--grant", `nadie-${randomUUID()}@test.local`], "\n");
    expect(missing.code).toBe(1);
    expect(missing.out).toMatch(/No existe una cuenta con el correo .* No se hizo ningún cambio/);

    const blocked = await createOrg("CLI bloqueada");
    await owner("update users set is_active = false, blocked_at = now(), blocked_reason = 'prueba' where id = $1", [blocked.owner.userId]);
    const r = await cli(["--grant", blocked.email], `${blocked.email}\n`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/bloqueada/);
    expect(await auditCount(blocked.owner.userId)).toBe(0);

    for (const args of [["--grant"], ["--grant", "--note", "x"], ["--grant", "a@b.co", "--revoke", "a@b.co"], [], ["--grant", blocked.email, "--note", ""]]) {
      expect((await cli(args, "\n")).code).toBe(1);
    }
  });

  it("--list muestra el destino y no pide confirmación", async () => {
    const r = await cli(["--list"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Base de datos de destino:");
  });
});
