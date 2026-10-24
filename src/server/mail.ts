import "server-only";
import { env } from "./env";

// Envío de correos sin proveedor externo. Ver MAIL_DRIVER en env.ts.
// Integrar un proveedor real (SMTP u otro) solo requiere implementar un driver nuevo aquí.

export type Mail = { to: string; subject: string; text: string };

const globalForMail = globalThis as unknown as { __inventoryOutbox?: Mail[] };

/** Bandeja en memoria (driver "memory"): solo para pruebas automatizadas. */
export function testOutbox(): Mail[] {
  return (globalForMail.__inventoryOutbox ??= []);
}

function driver() {
  const { MAIL_DRIVER, NODE_ENV } = env();
  const chosen = MAIL_DRIVER ?? (NODE_ENV === "test" ? "memory" : "disabled");
  // Escribir enlaces de recuperación en los registros de producción equivaldría a filtrarlos.
  if (chosen === "log" && NODE_ENV === "production") return "disabled";
  return chosen;
}

/** Devuelve true si el mensaje se entregó a algún canal. Nunca lanza: el llamador responde igual en todos los casos. */
export async function sendMail(mail: Mail): Promise<boolean> {
  try {
    switch (driver()) {
      case "memory":
        testOutbox().push(mail);
        return true;
      case "log":
        console.info(`[mail] Para: ${mail.to}\n[mail] Asunto: ${mail.subject}\n${mail.text}`);
        return true;
      default:
        return false;
    }
  } catch (err) {
    console.error("[mail] no se pudo enviar", err);
    return false;
  }
}
