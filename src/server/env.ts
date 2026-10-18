import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL debe ser una URL postgres://"),
  APP_URL: z.string().url().default("http://localhost:3100"),
  STORAGE_DIR: z.string().default("./storage"),
  ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

let cached: z.infer<typeof schema> | undefined;

export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Configuración inválida: ${issues}. Revisa .env.local (ver .env.example).`);
    }
    cached = parsed.data;
  }
  return cached;
}
