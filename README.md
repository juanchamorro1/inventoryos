# InventoryOS

Sistema SaaS multiempresa de inventario, compras y ventas. Funciona para cualquier tipo de negocio; incluye un escenario de demostración de una tienda de celulares.

- **Catálogo:** productos con variantes (p. ej. color y almacenamiento), SKU único por empresa, código de barras, categorías, marcas, atributos libres, impuestos, costos, precios y margen. Incluye imágenes e importación y exportación CSV con validación por fila.
- **Inventario:** existencias por bodega y ubicación; entradas, salidas, ajustes por conteo físico y transferencias. Historial inmutable con reversos, alertas de bajo stock, bloqueo del inventario negativo y verificación de consistencia contra el ledger.
- **Costeo:** promedio ponderado móvil por producto y bodega.
- **Compras:** proveedores y órdenes de compra (borrador → emitida → recibida parcial o total → cerrada o cancelada). Admite recepciones parciales y su anulación.
- **Ventas:** venta por mostrador con escáner o búsqueda, impuestos y descuentos (descuentos solo con permiso), devoluciones parciales y anulaciones con movimientos compensatorios. Incluye un registro de clientes.
- **Panel:** valor del inventario, ventas netas, utilidad bruta, bajo stock, productos más vendidos, ventas y compras por día, inventario por bodega y movimientos por tipo. Todo se calcula con datos reales y muestra estados vacíos cuando no hay datos.
- **SaaS:** registro, inicio de sesión y varias empresas por usuario. Cinco roles con permisos verificados en el servidor y aislamiento entre empresas en dos capas: la aplicación y Row-Level Security de PostgreSQL. Incluye auditoría, planes con límites y claves API de solo lectura para integraciones (p. ej. el asistente de WhatsApp).

La interfaz está pensada para personas con manejo intermedio del computador:

- Menú corto con un botón destacado para «Vender».
- Inicio con accesos a las tareas más comunes y una guía de primeros pasos.
- Lenguaje cotidiano en lugar de términos técnicos, con ayudas «¿Cómo funciona?».
- Producto simple por defecto: las presentaciones (colores, capacidades) son opcionales, el código interno se genera solo y se puede indicar la cantidad inicial.
- Números con formato colombiano: 1.599.000 o 2,5.

Arquitectura, invariantes y decisiones: [docs/architecture.md](docs/architecture.md). Publicarla en internet: [docs/deploy-vercel.md](docs/deploy-vercel.md).

## Requisitos

| Herramienta | Versión probada | Notas |
|---|---|---|
| Node.js | 24.x (mínimo 22) | incluye npm |
| PostgreSQL | 17 | una de estas dos opciones: **(A)** binarios nativos de PostgreSQL (solo se usan `initdb` y `pg_ctl`; no toca el servicio instalado) o **(B)** Docker Desktop |
| Navegador para E2E | Microsoft Edge | o Chrome / Chromium de Playwright (`PW_CHANNEL`) |

## Instalación

```bash
npm install
```

### Opción A: PostgreSQL local del proyecto (sin Docker)

Crea un clúster propio del proyecto en `.local/pgdata` en el puerto 5433 y genera `.env.local` con contraseñas aleatorias:

```bash
npm run db:local:init
```

```bash
npm run db:local:start
```

Si PostgreSQL no está en `C:\Program Files\PostgreSQL\17\bin`, define `PG_BIN` con la carpeta `bin`. Para detenerlo usa `npm run db:local:stop`.

### Opción B: Docker Compose

1. Copia `.env.example` a `.env.local` y reemplaza cada `<password>` por contraseñas propias.
2. Define `POSTGRES_ADMIN_PASSWORD` con la misma contraseña que pusiste en `DATABASE_ADMIN_URL`. Compose solo lee `.env`, no `.env.local`.
3. Inicia el contenedor:

```bash
docker compose up -d
```

El puerto es 5433. Si está ocupado, cámbialo con `POSTGRES_PORT`.

### Roles, bases de datos y migraciones (ambas opciones)

```bash
npm run db:setup
```

```bash
npm run db:migrate
```

- `db:setup` crea los roles `inventoryos_owner` (migraciones) e `inventoryos_app` (aplicación, sujeto a RLS), y las bases `inventoryos` e `inventoryos_test`.
- Las migraciones son SQL versionado en `drizzle/` y se aplican desde una base vacía.

## Ejecutar

```bash
npm run dev
```

Abre http://localhost:3100. Se usa el puerto 3100 para no chocar con otras apps en el 3000.

Para producción:

```bash
npm run build
```

```bash
npm start
```

En producción sirve la app detrás de HTTPS y define `APP_URL=https://…`. Así la cookie de sesión se marca `Secure`.

## Primera empresa y primer administrador

Tienes dos formas de crearlos.

**1. Desde la interfaz.** Entra en `/register`. Ahí se crean la empresa, la bodega principal, la ubicación GENERAL, los impuestos (IVA 19 %, IVA 5 %, Exento) y tu usuario propietario. Para deshabilitar el registro público usa `ALLOW_SIGNUP=false`.

**2. Por terminal**, sin exponer el registro público:

```bash
npm run admin:create -- --email admin@miempresa.com --name "Ana Pérez" --org "Mi Empresa"
```

- La contraseña se genera aleatoriamente y se muestra **una sola vez**. Si prefieres fijarla, defínela en la variable `INVENTORYOS_ADMIN_PASSWORD`.
- Cámbiala en **Mi cuenta** al ingresar.
- No existen usuarios ni contraseñas predeterminados.
- Para agregar más personas usa **Configuración › Usuarios y permisos**. Como no hay envío de correos, el administrador define una contraseña inicial y la comunica por un canal seguro.

## Datos de demostración

```bash
npm run db:seed:demo -- --email demo@tu-dominio.com
```

- Crea una **empresa nueva**, «CeluMundo (demostración)», marcada `is_demo` y con aviso visible en la interfaz.
- Contenido: 11 productos con 16 variantes, 2 bodegas, 3 ubicaciones, 3 proveedores, órdenes de compra (una recibida parcialmente), ventas, una devolución, una anulación, un ajuste y una merma.
- Crea usuarios de cada rol (propietario, gerente, vendedor, solo lectura) con contraseñas aleatorias. Se muestran una vez y se guardan en `.local/demo-credentials.txt`, que git ignora.
- Nunca modifica empresas existentes. Todo pasa por los mismos servicios que la app: validaciones, ledger y auditoría.
- Las fechas de la demostración son las del momento de la carga. El ledger no admite movimientos con fecha retroactiva, por diseño.

## Pruebas

| Comando | Qué ejecuta |
|---|---|
| `npm run typecheck` | TypeScript estricto |
| `npm run lint` | ESLint (configuración de Next.js) |
| `npm run test:unit` | Costeo (incluye una prueba de propiedades con 200 secuencias aleatorias), permisos y contraseñas |
| `npm run test:integration` | Contra **PostgreSQL real**: recrea `inventoryos_test` desde cero y aplica las migraciones |
| `npm test` | Unitarias + integración |
| `npm run test:e2e` | Playwright: compila la app (requiere `npm run build` antes), la levanta en el puerto 3200 contra la base de pruebas y recorre los flujos en Edge |

Las pruebas de integración cubren:

- **Migraciones y esquema:** las migraciones funcionan sobre una base vacía; cada tabla multiempresa tiene RLS forzado; el rol de la app no puede evadir RLS.
- **Autenticación:** registro, inicio de sesión, límite de intentos, sesiones, cambio de contraseña, roles, jerarquía de roles y límites de plan.
- **Aislamiento entre dos empresas:** lectura, escritura, referencias cruzadas, SQL directo, claves API.
- **Inventario:** entradas, salidas, ajustes, transferencias, reversos, inmutabilidad, idempotencia, bajo stock y conciliación.
- **Compras:** recepción parcial y total, exceso, anulación de recepción, cancelación y cierre, permisos.
- **Ventas:** impuestos y costos, devolución parcial y total, anulación, permisos de precios y descuentos.
- **Concurrencia:** 30 ventas simultáneas sobre 10 unidades, transferencias cruzadas, recepciones simultáneas y 20 envíos con la misma clave de idempotencia.
- **Catálogo:** CSV y validaciones.
- **Imágenes:** tipo real del archivo, tamaño y rutas.

Las pruebas E2E cubren registro, validaciones, creación y edición de producto, entrada de inventario, orden de compra con recepción parcial, venta, devolución, anulación, stock insuficiente, verificación de consistencia, clave API y aislamiento entre empresas desde el navegador.

## API para integraciones

Crea una clave en **Configuración › Conexión con otros sistemas**. Es de solo lectura y por empresa.

```bash
curl -H "Authorization: Bearer ios_…" "http://localhost:3100/api/v1/products?q=iphone"
```

- `GET /api/v1/products?q=&page=&limit=` busca productos.
- `GET /api/v1/products/{sku}` consulta un SKU.
- `GET /api/v1/openapi.json` devuelve el contrato completo.

Las respuestas incluyen precio sin y con impuesto, y existencias por bodega si la clave tiene `inventory:read`. Los errores usan el formato `application/problem+json`.

## Planes

`free` (3 usuarios, 2 bodegas, 500 variantes), `pro` y `enterprise`. Los límites están en `src/server/platform/plans.ts`. No hay pagos integrados; un operador asigna el plan con este comando (usa `DATABASE_ADMIN_URL`):

```bash
npm run org:plan -- --slug mi-empresa-ab12cd --plan pro
```

## Variables de entorno

Ver [.env.example](.env.example). `.env.local` contiene secretos y git lo ignora. La app valida su configuración al iniciar (`src/server/env.ts`).

## Respaldo y recuperación

Respaldo lógico (los binarios de PostgreSQL 17 incluyen `pg_dump` y `pg_restore`):

```bash
pg_dump --format=custom --file=respaldo.dump "postgres://inventoryos_admin:...@127.0.0.1:5433/inventoryos"
```

```bash
pg_restore --clean --if-exists --dbname="postgres://inventoryos_admin:...@127.0.0.1:5433/inventoryos" respaldo.dump
```

En producción usa PostgreSQL gestionado con recuperación a un punto en el tiempo (PITR), respaldos diarios en otro almacenamiento y un **simulacro de restauración periódico**. Tras restaurar, ejecuta *Configuración › Revisar el inventario* en cada empresa. Las fotos de productos se guardan en la base de datos, así que se respaldan con ella.

## Limitaciones conocidas y pendientes

- **Autenticación:**
  - No hay verificación de correo ni recuperación de contraseña; ambas requieren un proveedor de correo, que no está configurado.
  - Tampoco hay 2FA ni SSO.
  - Mientras tanto, el administrador restablece accesos creando la cuenta o desactivando y reactivando a la persona.
- **Pagos:** los planes existen, pero no hay cobro integrado.
- **WhatsApp:** solo existe la API de lectura. No se envían mensajes ni se consume la API de Meta.
- **Inventario:**
  - No hay lotes, números de serie ni IMEI, ni fechas de vencimiento.
  - No hay reservas de stock ni transferencias "en tránsito" (son inmediatas).
  - No hay conversiones de unidad de medida en compras.
- **Costeo:**
  - Los costos adicionales de compra (fletes, aranceles) solo se incluyen si van en el costo unitario de la orden.
  - Una sola moneda por empresa.
  - Las reglas contables deben validarse con un contador; ver docs/architecture.md.
- **Ventas:** no se emite factura electrónica ni hay integración con la DIAN u otros entes fiscales. Los precios se registran sin impuesto.
- **Imágenes:** se guardan en PostgreSQL (máximo 2 MB cada una). Con muchos miles de fotos convendría pasarlas a un almacenamiento de objetos.
- **API:** no tiene límite de peticiones por clave; agrégalo en el proxy o balanceador.
- **Panel:** usa consultas directas. Con volúmenes grandes convendría usar tablas de resumen.
- **Movimientos retroactivos:** no se admiten, por diseño, para no alterar el promedio ponderado histórico.
- **CI:** existe `.github/workflows/ci.yml`, pero no se ha ejecutado porque el repositorio no está en GitHub.
