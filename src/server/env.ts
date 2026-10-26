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
  // Envío de correos (enlaces de recuperación). No hay proveedor externo integrado:
  //   disabled: no se envía nada (predeterminado en producción; usar el enlace del administrador de plataforma).
  //   log:      escribe el enlace en la consola del servidor (solo desarrollo; se ignora en producción).
  //   memory:   lo guarda en memoria para las pruebas automatizadas.
  MAIL_DRIVER: z.preprocess((v) => (clean(v) as string | undefined)?.toLowerCase(), z.enum(["disabled", "log", "memory"]).optional()),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- Tasas de cambio ---
  // Proveedor de la TRM: datos-gov-co-trm (Superintendencia Financiera vía datos.gov.co) o none (sin consulta automática).
  // Sin definir: none en pruebas automatizadas (nunca se llama a la red) y datos-gov-co-trm en los demás entornos.
  EXCHANGE_RATE_PROVIDER: z.preprocess((v) => (clean(v) as string | undefined)?.toLowerCase(), z.enum(["datos-gov-co-trm", "none"]).optional()),
  /** Minutos mínimos entre consultas automáticas al proveedor (la TRM cambia una vez al día). */
  EXCHANGE_RATE_REFRESH_MINUTES: z.preprocess(clean, z.coerce.number().int().min(15).max(10080).default(360)),
  /** Variación máxima aceptada frente a la última tasa válida (%); una variación mayor se rechaza para revisión. */
  EXCHANGE_RATE_MAX_JUMP_PERCENT: z.preprocess(clean, z.coerce.number().min(1).max(100).default(15)),
  /** Token opcional de aplicación de Socrata (cabecera X-App-Token) para no compartir el límite por IP. */
  EXCHANGE_RATE_APP_TOKEN: z.preprocess(clean, z.string().max(200).optional()),
  /** Secreto que Vercel Cron envía como «Authorization: Bearer …» a /api/cron/exchange-rate. Sin él, la ruta queda deshabilitada. */
  CRON_SECRET: z.preprocess(clean, z.string().min(16, "debe tener al menos 16 caracteres").optional()),

  // --- Almacenamiento de imágenes ---
  // database: tabla stored_files de PostgreSQL (desarrollo y pruebas) · s3: almacenamiento de objetos compatible con S3
  // (AWS S3, Cloudflare R2, Backblaze B2, MinIO…). Las credenciales nunca llegan al navegador.
  STORAGE_DRIVER: z.preprocess((v) => (clean(v) as string | undefined)?.toLowerCase(), z.enum(["database", "s3"]).default("database")),
  S3_ENDPOINT: z.preprocess(clean, z.string().url("debe ser una URL, p. ej. https://<cuenta>.r2.cloudflarestorage.com").optional()),
  S3_REGION: z.preprocess(clean, z.string().max(40).default("auto")),
  S3_BUCKET: z.preprocess(clean, z.string().max(63).optional()),
  S3_ACCESS_KEY_ID: z.preprocess(clean, z.string().max(200).optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess(clean, z.string().max(200).optional()),
}).superRefine((v, ctx) => {
  if (v.STORAGE_DRIVER === "s3") {
    for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (!v[k]) ctx.addIssue({ code: "custom", path: [k], message: "es obligatoria con STORAGE_DRIVER=s3" });
    }
  }
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
