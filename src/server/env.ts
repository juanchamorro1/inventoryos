import { z } from "zod";
import { resolveDatabaseUrls } from "../../scripts/lib/database-urls.mjs";

// Valores tolerantes a errores comunes al pegarlos en paneles como Vercel:
// espacios, comillas, mayúsculas ("TRUE", "Sí") o variables vacías.
const clean = (v: unknown) => {
  if (typeof v !== "string") return v;
  const t = v.trim().replace(/^["']|["']$/g, "").trim();
  return t === "" ? undefined : t;
};

const bool = (fallback: boolean) =>
  z.preprocess(
    (v) => {
      const c = clean(v);
      if (c === undefined) return fallback;
      const s = String(c).toLowerCase();
      if (["true", "1", "yes", "si", "sí", "on"].includes(s)) return true;
      if (["false", "0", "no", "off"].includes(s)) return false;
      return c;
    },
    z.boolean({ message: 'debe ser "true" o "false"' }),
  );

// En Vercel, si APP_URL no está definida, se usa el dominio de producción del proyecto.
const vercelUrl = () => {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
};

const schema = z.object({
  DATABASE_URL: z.preprocess(
    clean,
    z.string({ message: "no hay base de datos conectada (en Vercel: Storage › Neon, y la variable INVENTORYOS_DB_PASSWORD)" }).regex(/^postgres(ql)?:\/\/.+/, "debe empezar por postgresql://"),
  ),
  APP_URL: z.preprocess(
    (v) => {
      const c = clean(v) as string | undefined;
      if (c && !/^https?:\/\//.test(c)) return `https://${c}`;
      return c ?? vercelUrl() ?? "http://localhost:3100";
    },
    z
      .string()
      .url("debe ser una dirección completa, p. ej. https://miapp.vercel.app")
      .transform((u) => u.replace(/\/+$/, "")),
  ),
  ALLOW_SIGNUP: bool(true),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Problemas de configuración, solo con el nombre de la variable (nunca su valor). */
const input = () => ({ ...process.env, DATABASE_URL: resolveDatabaseUrls().appUrl });

export function envProblems(): string[] {
  const parsed = schema.safeParse(input());
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(input());
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Configuración inválida: ${issues}. Revisa las variables de entorno (ver .env.example y docs/deploy-vercel.md).`);
    }
    cached = parsed.data;
  }
  return cached;
}
