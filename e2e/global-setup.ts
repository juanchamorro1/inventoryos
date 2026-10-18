import { runMigrations } from "../scripts/lib/migrations";

export default async function globalSetup() {
  const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
  const appUrl = process.env.TEST_DATABASE_URL;
  if (!ownerUrl || !appUrl || !new URL(ownerUrl).pathname.endsWith("_test")) {
    throw new Error("Configura TEST_DATABASE_OWNER_URL/TEST_DATABASE_URL apuntando a una base *_test.");
  }
  await runMigrations(ownerUrl, { reset: true, appRole: decodeURIComponent(new URL(appUrl).username) });
}
