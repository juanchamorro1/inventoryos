# Arquitectura de InventoryOS

## Visión general

Monolito modular en **Next.js 16 (App Router) + TypeScript estricto**, con **PostgreSQL 17** y **Drizzle ORM**. Una sola aplicación sirve la interfaz (Server Components + Server Actions) y la API pública (`/api/v1`). No hay microservicios, Redis ni colas: todo lo que debe ser consistente ocurre en una transacción de PostgreSQL.

```
src/
  app/                    Rutas, páginas y server actions (capa de presentación)
    (auth)/               login, registro, selección de empresa
    (app)/                módulos con barra lateral (requieren sesión y empresa)
    actions/              server actions: validan sesión y delegan en servicios
    api/v1/               API pública de solo lectura (claves API)
    api/files/            imágenes de productos (guardadas en PostgreSQL) con control de acceso
  components/             UI (servidor y cliente)
  lib/                    formato y utilidades compartidas con el cliente
  server/                 lógica de negocio (nunca se importa desde el cliente)
    db/                   cliente, esquema Drizzle, transacciones con contexto
    platform/             contexto, errores, permisos, decimales, auditoría,
                          idempotencia, numeración, planes, validación
    modules/
      auth/               contraseñas (scrypt), sesiones, contexto de empresa
      organizations/      empresa, miembros y roles
      invitations/        invitaciones de un solo uso (alta de miembros)
      catalog/            productos, variantes, categorías, marcas, impuestos, CSV
      warehouses/         bodegas y ubicaciones
      costing/            promedio ponderado (funciones puras)
      inventory/          motor de contabilización (ledger), consultas, conciliación
      purchasing/         proveedores, órdenes de compra, recepciones
      sales/              clientes, ventas, devoluciones, anulaciones
      analytics/          indicadores del panel
      api-keys/           claves API y auditoría
      integrations/       contrato de lectura para integraciones (WhatsApp)
drizzle/                  migraciones SQL versionadas (0000 esquema, 0001 seguridad)
scripts/                  setup de BD, migraciones, demo, alta de administrador
tests/unit, tests/integration, e2e/
```

Dependencias entre módulos: `purchasing` y `sales` usan el motor de `inventory`; `inventory` usa `costing`; ningún módulo de dominio importa de `app/`. Las páginas y acciones nunca acceden a la base de datos directamente: llaman a servicios que reciben un `TenantContext`.

## Multiempresa (aislamiento)

Dos capas independientes:

1. **Aplicación.** El `TenantContext` (empresa, usuario, rol) se construye solo en el servidor: cookie de sesión → sesión en BD → empresa activa → membresía activa consultada en BD. Cada servicio verifica el permiso (`requirePermission`). Un recurso de otra empresa responde 404.
2. **Base de datos.** La app se conecta como `inventoryos_app` (sin `BYPASSRLS`, no es dueño de tablas). Toda tabla con `organization_id` tiene **Row-Level Security habilitado y forzado** con la política `organization_id = app_current_org()`. El contexto se fija por transacción con `set_config('app.org_id', …, true)` (equivale a `SET LOCAL`): es seguro con pools y nunca se filtra a otra petición. Sin contexto, las consultas devuelven cero filas.

Además, las claves foráneas son **compuestas** `(organization_id, id)`: la base de datos rechaza referencias a filas de otra empresa aunque el código tuviera un error.

Una prueba (`tests/integration/schema.test.ts`) recorre `pg_catalog` y falla si alguna tabla con `organization_id` no tiene RLS forzado con política.

## Ledger de inventario

- `stock_documents` + `stock_movements` son de **solo inserción**: `REVOKE UPDATE, DELETE` al rol de la app y triggers que bloquean cambios incluso al dueño del esquema.
- Toda variación de stock pasa por `postStockDocument` (`src/server/modules/inventory/posting.ts`), que en una transacción:
  1. valida ubicaciones y variantes (RLS garantiza la empresa);
  2. crea si faltan y **bloquea con `SELECT … FOR UPDATE` en orden determinista** las filas de valoración `(variante, bodega)` y de saldo `(variante, ubicación)` — evita sobreventas y deadlocks;
  3. calcula costos con `costing` (decimal exacto);
  4. rechaza stock negativo (`InsufficientStockError`), además del `CHECK (on_hand >= 0)` en la tabla;
  5. inserta documento y movimientos con instantáneas (`*_after`) y actualiza saldos.
- Correcciones: **reversos** (`reverses_document_id` único → un documento solo se reversa una vez), devoluciones y anulaciones crean movimientos compensatorios. Nada se borra.
- `reconcile()` compara saldos y valoración contra la suma del ledger (pantalla *Configuración › Revisar el inventario*).

## Costeo: promedio ponderado móvil

Por **(variante, bodega)**. El valor total es la fuente de verdad:

```
Entrada (q, costo C):  Q' = Q + q ; V' = V + C ; promedio = V'/Q'
Salida  (q):           C = round(q · promedio, 4) ; V' = V − C
Si Q' = 0 → V' = 0 (la salida absorbe el residuo de redondeo)
```

- Transferencia: sale al promedio de origen y entra con ese mismo costo total al destino.
- Devolución de venta: reingresa al costo con que salió la línea.
- Anulación de recepción: sale al costo original; se rechaza si dejaría valor negativo o si las unidades ya no están.
- Precisión: cantidades `numeric(18,4)`, costo unitario `numeric(20,6)`, valores `numeric(20,4)`, tasas `numeric(7,4)`. En TypeScript se usa `decimal.js`; los `numeric` llegan como texto y nunca se convierten a `Number` para calcular. Redondeo *half-up*.

**Requiere validación contable profesional:** regla de redondeo, tratamiento de costos adicionales de compra (fletes, aranceles) que lleguen después de la recepción, IVA descontable vs. costo, devoluciones a proveedor y la norma aplicable (NIC 2 u otra local).

## Concurrencia e idempotencia

- Bloqueos de fila en orden fijo + `CHECK` en BD + reintentos automáticos ante `40001`/`40P01` (`withTenantTx`), `lock_timeout` de 5 s.
- Recepciones: se bloquea la orden y sus líneas; `CHECK quantity_received <= quantity_ordered`.
- Formularios críticos (movimientos, ventas, recepciones, devoluciones) envían una `idempotencyKey`. La clave se inserta en la misma transacción; una solicitud duplicada concurrente espera al índice único y devuelve el mismo resultado. Probado con 20 envíos simultáneos.
- Numeración consecutiva por empresa con `INSERT … ON CONFLICT DO UPDATE … RETURNING` (sin huecos ni duplicados).

## Autenticación

Implementación propia y acotada, construida solo con primitivas de la biblioteca estándar de Node:

- Contraseñas con **scrypt** (N=2¹⁵, r=8, p=1, sal aleatoria), comparación en tiempo constante, política mínima de 10 caracteres con letras y números.
- Sesiones con token aleatorio de 256 bits en cookie `HttpOnly`, `SameSite=Lax`, `Secure` cuando `APP_URL` es https; en BD solo se guarda el SHA-256 del token. Expiran a los 7 días.
- Límite de intentos: 5 fallos por correo o 30 por IP en 15 minutos.
- Cambiar la contraseña cierra las demás sesiones. Desactivar a un miembro le quita el acceso inmediatamente.
- Alta de miembros solo por invitación: token aleatorio de 32 bytes en el enlace, en la base solo su SHA-256, vence en 72 h y se consume con un `UPDATE ... WHERE status = 'pending' AND expires_at > now()` (una sola aceptación aunque lleguen varias a la vez). La persona acepta con su propia cuenta (mismo correo) o crea una con su propia contraseña; ninguna empresa crea ni modifica credenciales. La política RLS `invitation_token_lookup` solo deja ver la fila cuyo hash coincide.
- Las Server Actions de Next.js validan el origen de la petición (protección CSRF incorporada).
- **Recuperación** (`modules/auth/recovery.ts`): token de 32 bytes; en la base solo su SHA-256 (`password_reset_tokens`). Vence (30 min si lo pide la persona, 24 h si lo emite la plataforma) y se consume con `UPDATE ... WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()` después de bloquear la fila del usuario (mismo orden que el bloqueo de cuentas: sin interbloqueos y sin reactivar una cuenta bloqueada). Emitir uno nuevo anula los anteriores; usarlo cambia la contraseña, borra todas las sesiones y limpia los fallos de ingreso. La solicitud pública responde igual exista o no la cuenta.
- **Estado de la cuenta:** `users.is_active` (con `blocked_at` y `blocked_reason`; un CHECK exige `is_active = (blocked_at IS NULL)`) se verifica en cada solicitud al resolver la sesión, en las claves API (cuenta del creador) y al aceptar invitaciones (quien invita y quien acepta). Bloquear borra además todas las sesiones de la cuenta, en todas sus empresas.
- **Límites de solicitudes** (`platform/rate-limit.ts`): ventana fija en la tabla `rate_limits` (UPSERT atómico; funciona con varias instancias serverless); la clave es el SHA-256 de ámbito + valor.
- **Plataforma** (`modules/platform/service.ts`): rol de operador separado de los roles de empresa. `platform_admins` es de solo lectura para `inventoryos_app` (se modifica con `npm run platform:admin` y el rol dueño). Cada operación revalida en su transacción que quien actúa sigue siendo administrador con cuenta activa y exige una sesión de menos de 12 h. Auditoría en `platform_audit_logs` (solo inserción, con triggers como `audit_logs`). No consulta datos de negocio de las empresas.
- **Correo** (`server/mail.ts`): sin proveedor externo; `MAIL_DRIVER` = `disabled` | `log` (solo desarrollo) | `memory` (pruebas).

Se eligió frente a Better Auth/Clerk para no acoplar el esquema multiempresa a un tercero en esta etapa. **Pendiente** (ver README): proveedor de correo, verificación de correo, 2FA y SSO.

## Roles y permisos

| Rol | Permisos |
|---|---|
| Propietario / Administrador | Todo (solo un propietario asigna propietarios; la empresa conserva al menos uno) |
| Gerente | Catálogo, inventario, compras, ventas, descuentos, anulaciones, devoluciones, auditoría |
| Vendedor / Bodega | Vender a precio de lista, recibir mercancía, consultar |
| Solo lectura | Consultar |

La matriz está en `src/server/platform/permissions.ts` y se aplica en cada servicio, no solo en la interfaz.

## API para integraciones (WhatsApp)

`/api/v1` es de **solo lectura**, autenticada con claves `ios_…` por empresa (se guarda solo el hash; se muestran una vez). Permisos: `catalog:read`, `inventory:read`. La empresa sale de la clave, nunca de la petición. Contrato en `/api/v1/openapi.json`. No se envían mensajes ni se llama a Meta/WhatsApp.

## Catálogo y precios comerciales

- **Un solo catálogo:** `products` y `product_variants` (SKU único por empresa). Se agregaron columnas, no tablas paralelas. El precio minorista publicado sigue siendo `sale_price` (el que usa Ventas) y el mayorista es `wholesale_price`. Cada precio tiene su modo (`auto` | `manual`).
- **Costo de referencia comercial vs. costo contable:** `cost_amount` + `cost_currency` + `extra_cost_cop` producen `pricing_total_cost`, que también se copia a `cost_price` como referencia para compras. El costo contable sigue siendo el promedio ponderado de `stock_valuations` y nunca se recalcula por la TRM.
- **Cálculo** (`modules/pricing/calc.ts`, puro, `decimal.js`): tasa aplicada = TRM + ajuste (solo USD); precio = costo total / (1 − margen/100); redondeo `up` | `nearest` | `none` a un múltiplo. Márgenes por producto → categoría → general.
- **Recálculo** (`modules/pricing/service.ts`): un `UPDATE … FROM jsonb_to_recordset` por cada 500 variantes, bajo un `pg_advisory_xact_lock` por empresa. Los modos manuales nunca se tocan. Los automáticos se publican según `pricing_settings.apply_policy` (`auto` | `approval`); con aprobación quedan pendientes, y lo pendiente se calcula comparando el sugerido redondeado con el publicado, sin tabla extra. El primer precio de un producto creado o editado por una persona se publica de inmediato. Sin tasa válida (ausente u obsoleta) las variantes en USD se marcan `no_rate` y se conservan sus últimos valores.
- **Tasas:** `exchange_rates` y `exchange_rate_fetches` son globales (la TRM es nacional) y de solo inserción. `manual_exchange_rates` es por empresa, con RLS y de solo inserción. El adaptador `ExchangeRateProvider` (`modules/exchange/providers.ts`) implementa la TRM de datos.gov.co; las pruebas inyectan proveedores y nunca llaman a la red. El cron solo guarda la tasa global; cada empresa la aplica en `ensurePricesCurrent` (al abrir catálogo, precios o la API), sin consultas que crucen empresas.
- **Historial:** `price_history` (RLS, solo inserción, con trigger) guarda precio anterior y nuevo, modos, origen, sugerido, tasa, usuario y motivo.
- **Fotos:** `product_images` (RLS) guarda metadatos, orden, principal (índice único parcial) y la clave del objeto. `object-storage.ts` abstrae los drivers `database` (`stored_files`) y `s3` (firma SigV4 propia en `s3-sign.ts`, verificada con el ejemplo oficial de AWS). La autorización siempre pasa por la fila con RLS.
- **Contrato de lectura para la web:** `modules/integrations/public-catalog.ts` y `GET /api/v1/catalog`, que expone solo datos publicados y usa el UUID del producto y el SKU como identificadores estables.
- **Permiso `pricing.manage`** (propietario, administrador y gerente): configuración, tasas manuales, precios manuales, vuelta a automático y aprobación.
- **Migración 0005:** solo aditiva. Las variantes existentes quedan con precio **manual** (nada cambia en silencio) y la foto única anterior pasa a `product_images`. El relleno quita `FORCE ROW LEVEL SECURITY` solo dentro de la transacción de la migración (el dueño también está sujeto a RLS forzado). La reversión manual está en `docs/rollback/0005_pricing_catalog.down.sql`.

## Auditoría

`audit_logs` (solo inserción) registra en la misma transacción: altas y cambios de productos, movimientos, compras, ventas, devoluciones, miembros, impuestos, claves API y configuración.
