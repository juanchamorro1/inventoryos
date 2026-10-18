# Publicar InventoryOS en Vercel

Vercel ejecuta la aplicación; los datos (productos, ventas, usuarios) viven en una **base de datos PostgreSQL**. La forma más sencilla es crearla desde el mismo Vercel, con Neon.

> El plan gratuito de Vercel (Hobby) es solo para uso **no comercial**. Si vas a cobrar a empresas por usar InventoryOS, necesitas el plan Pro.

## Opción recomendada: base de datos desde Vercel (pocos clics)

### 1. Crear y conectar la base de datos

1. En Vercel, abre tu proyecto **inventoryos**.
2. Ve a la pestaña **Storage** y pulsa **Create Database**.
3. Elige **Neon** (Serverless Postgres) y pulsa **Continue**.
4. Elige el plan gratuito y la región más cercana a tus usuarios (por ejemplo *Washington, D.C.*).
5. Pon un nombre (por ejemplo `inventoryos-db`) y pulsa **Create**.
6. Cuando pregunte a qué proyecto conectarla, elige **inventoryos**, deja marcados todos los entornos y pulsa **Connect**.

Vercel agrega solo las variables de conexión (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`…). No las cambies.

### 2. Agregar una contraseña para la aplicación

La aplicación entra a la base de datos con un usuario propio y restringido (`inventoryos_app`), que no puede ver datos de otras empresas. Solo debes inventarle una contraseña:

1. Ve a **Settings › Environment Variables**.
2. Agrega:
   - **Key:** `INVENTORYOS_DB_PASSWORD`
   - **Value:** una contraseña larga de al menos 24 letras y números, por ejemplo copiada de un generador de contraseñas.
   - **Environments:** marca *Production*.
3. Pulsa **Save**.

No necesitas recordarla: el sistema la usa solo.

### 3. Revisar las variables opcionales

| Variable | ¿Hace falta? | Valor |
|---|---|---|
| `APP_URL` | Opcional | La dirección de tu app, p. ej. `https://inventoryos-psi.vercel.app`. Si no la pones, se usa la de Vercel. Si la pones, debe empezar por `https://`. |
| `ALLOW_SIGNUP` | Opcional | `true` (por defecto): cualquiera puede registrar su empresa. `false`: solo tú creas empresas. |

Si antes creaste a mano `DATABASE_URL`, `DATABASE_OWNER_URL` o `DATABASE_ADMIN_URL`, **bórralas**: ahora las pone Neon.

### 4. Volver a desplegar

1. Ve a **Deployments**.
2. En el despliegue más reciente pulsa los tres puntos **⋯ › Redeploy**.

El despliegue hace todo solo:

- crea el usuario `inventoryos_app`;
- crea las tablas;
- verifica la seguridad;
- publica la app.

### 5. Comprobar

- Abre `https://TU-APP.vercel.app/api/health`. Debe decir `"ok": true`.
- Abre `https://TU-APP.vercel.app/register` y crea tu empresa y tu usuario.

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| El build dice «No hay base de datos configurada» | Falta el paso 1 (conectar Neon) o el paso 2 (`INVENTORYOS_DB_PASSWORD`). |
| El build falla al «Configurar roles» con un error de permisos | Abre la base en Neon (Storage › tu base › *Open in Neon*), entra al **SQL Editor** y ejecuta `CREATE ROLE inventoryos_app LOGIN PASSWORD 'LA_MISMA_CONTRASEÑA';`. Luego vuelve a desplegar. |
| `/api/health` muestra `"database": "error…"` | Copia ese mensaje y compártelo con soporte técnico. |
| El inicio de sesión no se mantiene | `APP_URL` no coincide con la dirección real. Bórrala para que se use la de Vercel. |

## Opción avanzada: configurar la conexión a mano

Si prefieres otra base PostgreSQL (Neon creada aparte, Supabase, un servidor propio…), en vez de `INVENTORYOS_DB_PASSWORD` define:

| Variable | Valor |
|---|---|
| `DATABASE_ADMIN_URL` | Usuario con permiso para crear roles (conexión directa) |
| `DATABASE_OWNER_URL` | Dueño del esquema; ejecuta las migraciones |
| `DATABASE_URL` | `postgresql://inventoryos_app:CONTRASEÑA@host/base?sslmode=require` |

Los despliegues de vista previa (ramas distintas de `main`) no modifican la base de datos, salvo que definas `MIGRATE_ON_PREVIEW=true`.

## Respaldos

Neon guarda el historial y permite restaurar la base a un momento anterior; el plazo depende de tu plan. Las fotos de productos están dentro de la base de datos, así que se respaldan junto con ella. Después de una restauración, revisa **Configuración › Revisar el inventario** en cada empresa.
