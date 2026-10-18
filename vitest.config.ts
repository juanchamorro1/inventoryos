import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Carga .env.local (secretos locales) si existe; en CI las variables llegan por el entorno.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          // Las pruebas comparten la base de pruebas; cada archivo crea sus propias empresas.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            DB_POOL_MAX: "40",
            NODE_ENV: "test",
            STORAGE_DIR: path.resolve(import.meta.dirname, ".local", "test-storage"),
          },
        },
      },
    ],
  },
});
