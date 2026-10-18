import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = 3200;
const baseURL = `http://localhost:${PORT}`;

// Las pruebas E2E levantan la app compilada contra la base de PRUEBAS (se recrea en global-setup).
// Navegador: Microsoft Edge instalado en el sistema (PW_CHANNEL=chrome para Google Chrome, o
// PW_CHANNEL=chromium tras `npx playwright install chromium`).
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    channel: process.env.PW_CHANNEL ?? "msedge",
    locale: "es-CO",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next start --port ${PORT}`,
    url: `${baseURL}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      APP_URL: baseURL,
      STORAGE_DIR: ".local/e2e-storage",
      ALLOW_SIGNUP: "true",
    },
  },
});
