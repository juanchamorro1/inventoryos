// Crea la primera empresa y su usuario propietario (administrador).
//   npm run admin:create -- --email admin@miempresa.com --name "Ana Pérez" --org "Mi Empresa" [--currency COP]
// La contraseña se toma de INVENTORYOS_ADMIN_PASSWORD o se genera aleatoriamente y se muestra UNA vez.
import { closeDb } from "../src/server/db/client";
import { registerOwner } from "../src/server/modules/auth/service";
import { generatePassword } from "../src/server/modules/auth/password";
import { ValidationError } from "../src/server/platform/errors";
import { arg } from "./lib/args";

const email = arg("email");
const name = arg("name");
const org = arg("org");
if (!email || !name || !org) {
  console.error('Uso: npm run admin:create -- --email correo@empresa.com --name "Nombre" --org "Empresa" [--currency COP]');
  process.exit(1);
}
const provided = process.env.INVENTORYOS_ADMIN_PASSWORD;
const password = provided ?? generatePassword();

try {
  const { organizationId } = await registerOwner({ email, name, organizationName: org, password, currency: arg("currency") ?? "COP" });
  console.log("\nEmpresa y propietario creados.");
  console.log(`  Empresa:   ${org} (${organizationId})`);
  console.log(`  Usuario:   ${email}`);
  if (!provided) {
    console.log(`  Contraseña temporal: ${password}`);
    console.log("  Guárdala ahora y cámbiala en «Mi cuenta» al ingresar. No se volverá a mostrar.");
  }
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(`Error: ${err.message}`, err.fieldErrors);
    process.exitCode = 1;
  } else throw err;
} finally {
  await closeDb();
}
