# Publicar InventoryOS en Vercel

Necesitas dos servicios: **Vercel**, donde corre la aplicación, y **Neon**, donde vive la base de datos PostgreSQL. Ambos tienen plan gratuito.

> El plan gratuito de Vercel (Hobby) es solo para uso **no comercial**. Si vas a cobrar a empresas por usar InventoryOS, necesitas el plan Pro.

## 1. Crear la base de datos en Neon

1. Entra a https://neon.tech, crea una cuenta y un proyecto nuevo.
   - **Versión de PostgreSQL:** 17.
   - **Región:** la más cercana a tus usuarios (por ejemplo *AWS US East* o *São Paulo*).
2. En **Dashboard › Connect** copia dos cadenas de conexión del rol `neondb_owner`:
   - **Directa:** desactiva *Connection pooling*. Se ve así: `postgresql://neondb_owner:…@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`
   - **Con pooling:** actívalo. Lleva `-pooler` en el host: `…@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require`
3. Inventa una contraseña larga para el usuario que usará la aplicación. Puedes generarla con:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

No crees tablas a mano: el despliegue las crea solo.

## 2. Crear el proyecto en Vercel

1. Entra a https://vercel.com e inicia sesión con tu cuenta de GitHub.
2. Ve a **Add New › Project** e importa el repositorio `inventoryos`. Vercel detecta Next.js automáticamente; no cambies los comandos.
3. Antes de pulsar *Deploy*, abre **Environment Variables** y agrega las siguientes, en el entorno **Production**:

| Variable | Valor |
|---|---|
| `DATABASE_ADMIN_URL` | La cadena **directa** de `neondb_owner` |
| `DATABASE_OWNER_URL` | La misma cadena **directa** de `neondb_owner` |
| `DATABASE_URL` | La cadena **con pooling**, cambiando el usuario y la contraseña: `postgresql://inventoryos_app:TU_CONTRASEÑA@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require` |
| `APP_URL` | La dirección final de tu app, por ejemplo `https://inventoryos.vercel.app`. Si aún no la conoces, ponla después del primer despliegue y vuelve a desplegar. |
| `ALLOW_SIGNUP` | `true` para que cualquiera registre su empresa, o `false` para crearlas tú |

4. En **Settings › Functions › Function Region** elige la misma región que en Neon. Si no, cada consulta viaja lejos y la app se siente lenta.
5. Pulsa **Deploy**.

En cada despliegue, el comando `vercel-build` hace lo siguiente:

- crea o actualiza el usuario `inventoryos_app`, que **no** puede saltarse la seguridad entre empresas;
- aplica las migraciones pendientes;
- verifica que la app no use un usuario con permisos de más (si lo hace, el despliegue falla con un mensaje claro);
- compila la aplicación.

Los despliegues de vista previa (ramas distintas de `main`) **no** tocan la base de datos, salvo que definas `MIGRATE_ON_PREVIEW=true`.

## 3. Primer uso

1. Abre la dirección de tu app y entra a `/register` para crear tu empresa y tu usuario propietario.
2. Si definiste `ALLOW_SIGNUP=false`, crea la primera empresa desde tu computador apuntando a la base de Neon:

   ```bash
   npm run admin:create -- --email tu@correo.com --name "Tu nombre" --org "Tu empresa"
   ```

   Para eso, pon temporalmente las variables de Neon en `.env.local`.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| El build falla con «Faltan DATABASE_OWNER_URL…» | Falta alguna variable en Vercel, o no está marcada para *Production*. |
| El build falla con «usa un rol que puede saltarse la seguridad» | `DATABASE_URL` tiene el usuario `neondb_owner`. Debe ser `inventoryos_app`. |
| Error de permisos al crear el rol | Ese usuario de Neon no puede crear roles. Crea el rol en el **SQL Editor** de Neon con `CREATE ROLE inventoryos_app LOGIN PASSWORD 'TU_CONTRASEÑA';` y vuelve a desplegar. |
| La app carga, pero al iniciar sesión da error de conexión | Prueba `DATABASE_URL` con el host **sin** `-pooler`. |
| El inicio de sesión no se mantiene | `APP_URL` no coincide con la dirección real (debe empezar por `https://`). |

## Respaldos

Neon guarda el historial y permite restaurar la base a un momento anterior (*Restore*); el plazo depende de tu plan. Las fotos de productos están dentro de la base de datos, así que se respaldan junto con ella. Después de una restauración, revisa **Configuración › Revisar el inventario** en cada empresa.
