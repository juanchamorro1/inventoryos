// Resuelve las 3 conexiones que usa InventoryOS a partir de las variables disponibles.
//
// Modo manual (local, Docker o Neon configurado a mano):
//   DATABASE_URL        → rol de la aplicación (inventoryos_app)
//   DATABASE_OWNER_URL  → dueño del esquema (migraciones)
//   DATABASE_ADMIN_URL  → crea roles (opcional)
//
// Modo Vercel + Neon (integración de la pestaña Storage, que define DATABASE_URL con el usuario dueño):
//   INVENTORYOS_DB_PASSWORD  → contraseña que eliges para el usuario inventoryos_app
//   La app se conecta como inventoryos_app usando el mismo servidor que DATABASE_URL,
//   y las migraciones usan la conexión directa del dueño (DATABASE_URL_UNPOOLED).

const APP_ROLE = "inventoryos_app";

const clean = (v) => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/^["']|["']$/g, "").trim();
  return t === "" ? undefined : t;
};

export function resolveDatabaseUrls(env = process.env) {
  const appPassword = clean(env.INVENTORYOS_DB_PASSWORD);
  const provided = clean(env.DATABASE_URL) ?? clean(env.POSTGRES_URL);
  const direct = clean(env.DATABASE_URL_UNPOOLED) ?? clean(env.POSTGRES_URL_NON_POOLING);

  if (appPassword && provided) {
    const app = new URL(provided);
    app.username = APP_ROLE;
    app.password = appPassword;
    const owner = clean(env.DATABASE_OWNER_URL) ?? direct ?? provided;
    return {
      mode: "vercel-neon",
      appUrl: app.toString(),
      ownerUrl: owner,
      adminUrl: clean(env.DATABASE_ADMIN_URL) ?? owner,
    };
  }
  return {
    mode: "manual",
    appUrl: provided,
    ownerUrl: clean(env.DATABASE_OWNER_URL),
    adminUrl: clean(env.DATABASE_ADMIN_URL),
  };
}
