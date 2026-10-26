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
- Para agregar más personas usa **Configuración › Usuarios y permisos › Invitar a una persona**. Se genera un enlace de un solo uso que vence en 72 horas; envíalo por un canal privado. La persona elige su propia contraseña (o, si ya tiene cuenta, inicia sesión y acepta). Nadie de la empresa conoce ni puede cambiar la contraseña de otra cuenta.

## Recuperación y protección de cuentas

- **¿Olvidaste tu contraseña?** (en la pantalla de ingreso): la respuesta es siempre la misma, exista o no la cuenta. Si la cuenta existe y está activa se emite un enlace de un solo uso que vence en 30 minutos; en la base solo queda su SHA-256. Al usarlo se cierran todas las sesiones de la cuenta.
- **Entrega del enlace:** no hay proveedor de correo integrado (ver `MAIL_DRIVER`). En producción el formulario no envía nada; el soporte genera el enlace desde **Plataforma** después de verificar la identidad de la persona y se lo entrega por un canal privado (vence en 24 horas). Solo la persona elige su contraseña.
- **Mi cuenta › Cerrar sesión en todos los dispositivos:** cierra todas las sesiones de la cuenta, en todas sus empresas. «Salir» cierra solo la actual.
- **Límites:** recuperación 10 solicitudes por IP y 3 por correo cada hora (el límite por correo es silencioso); 20 envíos de contraseña por IP cada 15 minutos; inicio de sesión como antes (5 fallos por correo o 30 por IP en 15 minutos). Los contadores se guardan en PostgreSQL con la clave como SHA-256.

### Administradores de plataforma

Son los operadores de InventoryOS (soporte), distintos de los roles de cada empresa: ser propietario o administrador de una empresa **no** da ningún poder de plataforma. En `/platform` (enlace en *Mi cuenta*) pueden:

- buscar una cuenta por correo exacto (solo ven datos de la cuenta, no los de sus empresas);
- **bloquear** una cuenta con un motivo: no puede ingresar a ninguna empresa, se borran al instante todas sus sesiones, sus enlaces de recuperación quedan anulados y sus claves API dejan de funcionar; y **desbloquearla** después;
- cerrar todas sus sesiones y generar un enlace de recuperación.

Exigen una sesión iniciada hace menos de 12 horas, no se aplican a la propia cuenta ni a otros administradores de plataforma y todo queda en `platform_audit_logs` (solo inserción). La aplicación solo puede **leer** `platform_admins`; el rol se otorga y retira únicamente con el rol dueño de la base, mediante el script `platform:admin`:

- Muestra primero la base de destino (servidor, base, usuario; nunca la contraseña), indica si es LOCAL, y los datos de la cuenta.
- Para otorgar o retirar pide escribir el correo de la cuenta; cualquier otra respuesta (o ninguna) cancela sin cambios.
- Valida el correo como la aplicación, rechaza cuentas inexistentes o bloqueadas y es idempotente: si no hay cambio real no pide confirmación ni escribe auditoría. Cada cambio real queda en `platform_audit_logs` (`platform.admin_granted` / `platform.admin_revoked`, con la base y la nota).

Contra la base local (usa `.env.local`):

```bash
npm run platform:admin -- --list
```

```bash
npm run platform:admin -- --grant soporte@tu-dominio.com --note "Soporte"
```

Contra producción, **no** pongas la conexión de Neon en `.env.local` (ya contiene la conexión local y los demás scripts la usarían). Usa un archivo aparte dentro de `.local/` (ignorado por git) y pásalo explícitamente; ver `docs/deploy-vercel.md`.

## Catálogo, costos y precios (USD/COP)

### Registrar un producto

**Productos › Agregar producto.** Solo el nombre es obligatorio.

- **¿Cuánto te cuesta?**: el costo original y su moneda (COP o USD), más los gastos adicionales fijos por unidad en COP (flete, nacionalización…).
- **Precio minorista / mayorista**: déjalos vacíos para que se calculen solos. Si escribes un valor, queda como precio **manual** y ningún cambio de tasa o de costo lo modifica. Se pide un motivo y, si queda por debajo del costo, una confirmación.
- **Cantidad mínima mayorista**, **código de referencia** (búsqueda), **proveedor habitual** y **márgenes propios** (en «Más detalles»).
- **Fotos**: varias por producto (JPG, PNG o WEBP, máximo 2 MB cada una y 10 por producto). La primera es la principal. En la ficha del producto se cambian la principal, el orden y el texto alternativo, y se borran fotos.

El catálogo tiene búsqueda (nombre, SKU, código de barras y de referencia), filtros (categoría, marca, estado, moneda del costo, precios manuales, pendientes, sin tasa o bajo el costo), orden, paginación y vistas de **lista** y **cuadrícula**. Los listados solo devuelven el identificador de la foto principal, nunca archivos.

### Cómo se calcula el precio

```
Tasa aplicada  = TRM válida (COP/USD) + ajuste        ← ajuste inicial 100, configurable; solo para costos en USD
Costo en COP   = costo original × tasa aplicada        (si el costo ya está en COP, no se aplica ajuste ni TRM)
Costo total    = costo en COP × (1 + gastos % / 100) + gastos fijos en COP
Precio sugerido = costo total / (1 − margen / 100)     ← margen SOBRE EL PRECIO de venta (0 ≤ margen < 100)
Precio publicado = sugerido redondeado (inicial: al siguiente múltiplo de 100 COP)
```

- Márgenes con precedencia **producto → categoría → configuración general**, independientes para minorista y mayorista (iniciales: 30 % y 20 %).
- Todo con `decimal.js` y `numeric` en PostgreSQL; nunca punto flotante para dinero.
- El precio minorista publicado es el que usa Ventas (`sale_price`). El mayorista se publica aparte; Ventas todavía no lo aplica automáticamente por cantidad.
- El **costo de referencia comercial** (USD convertido + gastos) es distinto del **costo contable del inventario** (promedio ponderado en `stock_valuations`). Cambiar la TRM, el costo o un precio **no** crea movimientos, no toca documentos ni recalcula el costo histórico.

### Tasa de cambio (TRM)

- **Fuente automática:** TRM oficial certificada por la Superintendencia Financiera de Colombia, publicada en datos.gov.co (conjunto `32sa-8pi3`, licencia CC BY-SA 4.0; se cita la fuente en la interfaz). Se valida la respuesta (unidad COP, valor numérico entre 1.000 y 20.000, vigencia coherente y no futura, variación máxima frente a la última tasa válida). Los errores de red, los tiempos de espera (10 s), el límite del proveedor (429) y las respuestas inválidas se registran y **se conserva la última tasa válida**.
- **Consulta programada:** Vercel Cron llama a `/api/cron/exchange-rate` todos los días (`vercel.json`, 8:15 a. m. de Bogotá) con `CRON_SECRET`. `EXCHANGE_RATE_REFRESH_MINUTES` fija el intervalo mínimo entre consultas. También hay un botón **Consultar la TRM ahora** (máximo una vez cada 5 minutos).
- **Tasa manual:** en **Precios › Registrar TRM manualmente** (quién, cuándo y motivo quedan registrados). La empresa pasa a modo manual.
- **Tasa obsoleta o ausente:** pasado el fin de vigencia más la tolerancia configurada (48 h por defecto), no se generan precios nuevos para productos en USD. Se conservan sus últimos precios válidos y se muestra una advertencia en el catálogo, la ficha y Precios.

### Actualizar la tasa y revisar los precios

1. **Precios** muestra la tasa vigente y su fuente, los contadores (pendientes, manuales, en USD, sin tasa, bajo el costo), la configuración y el historial de consultas.
2. Cuando llega una TRM nueva, cambia un costo o cambian los márgenes, se recalculan los sugeridos. Con la política **Requiere aprobación** (predeterminada), los precios automáticos que cambiarían aparecen en **Precios › Cambios pendientes** con el valor actual, el nuevo y la variación. Se aprueban todos o los seleccionados. Con la política **Actualizar al instante**, se publican solos.
3. Los precios **manuales** nunca cambian solos: se guarda su sugerido para comparar y se pueden devolver a automático.
4. **Precios › Historial** registra cada cambio publicado: precio anterior y nuevo, modo, origen (automático, aprobado, manual, vuelta a automático o importación), tasa, usuario, fecha y motivo.

La TRM nueva se obtiene una vez al día para todo el sistema. Cada empresa recalcula sus precios la próxima vez que se abre su catálogo, sus precios o la API, siempre según su política.

### Importar cientos de productos

**Productos › Importar desde Excel.**

1. Guarda la hoja como **CSV UTF-8**; se acepta coma, punto y coma o tabulador. No se leen archivos `.xlsx` directamente: no hay dependencia para Excel.
2. Columnas: `producto, sku, variante, opciones, categoria, marca, codigo_barras, codigo_referencia, proveedor, moneda_costo, costo, costo_adicional, precio, precio_mayorista, minimo_mayorista, margen_minorista, margen_mayorista, impuesto, stock_minimo, unidad, descripcion`.
   - **Precios**: un número fija un precio manual; vacío lo deja automático (o sin cambios si el SKU existe); `auto` lo devuelve a automático.
   - **SKU existente**: si el SKU ya existe se actualiza, y sus celdas vacías no cambian nada.
   - **Plantilla**: «Descargar lista» exporta el catálogo con el mismo formato.
3. **Validar**: el navegador lee el archivo, detecta SKU y códigos de barras repetidos en todo el archivo y envía lotes de 100 filas para validarlos contra la base **sin guardar**. Los errores se muestran por fila.
4. **Importar**: cada lote de 100 filas se aplica en su propia transacción. Si un lote falla, se informa cuántos se aplicaron. Reimportar el archivo corregido es seguro: actualiza, no duplica.

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
- **Invitaciones:** un solo uso, vencimiento, anulación, ataques entre empresas, concurrencia y RLS.
- **Catálogo y precios:** conversión USD con ajuste, COP sin ajuste, precedencia de márgenes, redondeo, gastos adicionales, precios manuales preservados ante cambios de tasa, política de aprobación, vuelta a automático, precios bajo el costo, tasas ausentes y obsoletas, fallos y límites del proveedor, inventario intacto, aislamiento entre empresas, permisos, historial inmutable e importación por lotes (filas correctas, errores, duplicados, límites).
- **Fotos:** principal, orden, texto alternativo, tipo real del archivo, tamaño, máximo por producto, borrado, autorización y aislamiento.
- **Recuperación de cuentas:** respuestas neutras, tokens vencidos, reutilizados y manipulados, 10 envíos simultáneos, límites por IP y por correo, cierre de todas las sesiones.
- **Plataforma:** script `platform:admin` (destino visible, confirmación, idempotencia, auditoría solo de cambios reales, correos inválidos e inexistentes); solo administradores de plataforma (no los de empresa), sesión reciente, bloqueo y desbloqueo, sesiones revocadas en todas las empresas, claves API e invitaciones de cuentas bloqueadas, auditoría y permisos de la base.
- **Aislamiento entre dos empresas:** lectura, escritura, referencias cruzadas, SQL directo, claves API.
- **Inventario:** entradas, salidas, ajustes, transferencias, reversos, inmutabilidad, idempotencia, bajo stock y conciliación.
- **Compras:** recepción parcial y total, exceso, anulación de recepción, cancelación y cierre, permisos.
- **Ventas:** impuestos y costos, devolución parcial y total, anulación, permisos de precios y descuentos.
- **Concurrencia:** 30 ventas simultáneas sobre 10 unidades, transferencias cruzadas, recepciones simultáneas y 20 envíos con la misma clave de idempotencia.
- **Catálogo:** CSV y validaciones.
- **Imágenes:** tipo real del archivo, tamaño y rutas.

Las pruebas E2E cubren registro, validaciones, creación y edición de producto, entrada de inventario, orden de compra con recepción parcial, venta, devolución, anulación, stock insuficiente, verificación de consistencia, clave API y aislamiento entre empresas desde el navegador.

## API para integraciones

- `GET /api/v1/catalog?q=&category=&page=&limit=`: catálogo publicado para la futura web pública. Devuelve productos activos con variantes, fotos (`/api/v1/images/{id}` con la misma clave) y precios minorista y mayorista publicados, con y sin impuesto. Nunca expone costos, márgenes ni proveedores. Los identificadores estables son el UUID del producto y el SKU de cada variante. La web no accede a la base de datos ni a funciones administrativas: usa una clave de solo lectura.

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

- `STORAGE_DRIVER`: `database` (predeterminado; las fotos van a la tabla `stored_files` de PostgreSQL, adecuado para desarrollo y volúmenes pequeños) o `s3` (almacenamiento de objetos compatible con S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO). Con `s3` son obligatorias `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` y opcional `S3_REGION` (`auto`). Las credenciales solo existen en el servidor: las subidas pasan por la app, que valida tipo y tamaño, y las lecturas se autorizan en `/api/images/<id>` y redirigen a una URL prefirmada de 5 minutos. Las fotos ya guardadas siguen funcionando con su driver original.
- `EXCHANGE_RATE_PROVIDER`: `datos-gov-co-trm` (predeterminado) o `none`. `EXCHANGE_RATE_REFRESH_MINUTES` (360), `EXCHANGE_RATE_MAX_JUMP_PERCENT` (15), `EXCHANGE_RATE_APP_TOKEN` (opcional, token gratuito de Socrata para no compartir el límite por IP) y `CRON_SECRET` (mínimo 16 caracteres; sin él la ruta del cron responde 503).
- `MAIL_DRIVER`: `disabled` (predeterminado; no se envían correos), `log` (solo desarrollo: escribe el enlace en la consola; en producción se ignora para no dejar enlaces en los registros) o `memory` (pruebas automatizadas). Otro valor impide iniciar la app.

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
  - No hay proveedor de correo: en producción «¿Olvidaste tu contraseña?» no entrega el enlace; lo genera el soporte desde **Plataforma**. Tampoco hay verificación de correo.
  - No hay 2FA ni SSO, ni una lista de sesiones por dispositivo (solo «cerrar todas»).
  - Las cuentas creadas antes de las invitaciones con una contraseña elegida por un administrador siguen vigentes: conviene generarles un enlace de recuperación.
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
- **Precios:** Ventas usa el precio minorista publicado; el precio mayorista se calcula y publica, pero todavía no se aplica solo al vender por cantidad. No hay web pública ni exportación a PDF: `/api/v1/catalog` ya expone el contrato de lectura para construirlas.
- **Fotos:** sin almacenamiento de objetos configurado (`STORAGE_DRIVER=database`) las fotos ocupan espacio en PostgreSQL. No se generan miniaturas.
- **TRM:** depende de la disponibilidad de datos.gov.co. En el plan Hobby de Vercel el cron se ejecuta como máximo una vez al día. Si la fuente falla, se usa la última tasa válida o una tasa manual.
- **Panel:** usa consultas directas. Con volúmenes grandes convendría usar tablas de resumen.
- **Movimientos retroactivos:** no se admiten, por diseño, para no alterar el promedio ponderado histórico.
- **CI:** existe `.github/workflows/ci.yml`, pero no se ha ejecutado porque el repositorio no está en GitHub.
