# InventoryOS — guía para agentes

SaaS multiempresa de inventario, compras y ventas. Next.js 16 (App Router) + TypeScript estricto + PostgreSQL 17 + Drizzle. Monolito modular. Detalle: `docs/architecture.md`.

## Comandos
- `npm run dev` (puerto 3100) · `npm run build` · `npm run typecheck` · `npm run lint`
- `npm test` (unitarias + integración contra PostgreSQL real; recrea `inventoryos_test`)
- `npm run test:e2e` (requiere `npm run build`; usa Edge y la base de pruebas, puerto 3200)
- BD local sin Docker: `npm run db:local:start`; migraciones: `npm run db:migrate`
- Nueva migración: editar `src/server/db/schema/*` → `npx drizzle-kit generate --name <nombre>` → revisar el SQL. SQL manual (RLS, triggers): `npx drizzle-kit generate --custom --name <nombre>`.

## Invariantes (no negociables)
1. Todo acceso a datos de negocio pasa por un servicio en `src/server/modules/*` que recibe `TenantContext` y usa `withTenantTx`. Páginas y actions no consultan la BD directamente.
2. Toda tabla de negocio tiene `organization_id`, RLS habilitado+forzado (lo verifica `tests/integration/schema.test.ts`) y FKs compuestas `(organization_id, id)`. Tabla nueva ⇒ agregar su política en una migración SQL.
3. El contexto de empresa se fija solo con `set_config(..., true)` dentro de la transacción. Nunca `SET` de sesión.
4. Toda variación de stock pasa por `postStockDocument`. `stock_documents`, `stock_movements` y `audit_logs` son de solo inserción: las correcciones son reversos o movimientos compensatorios.
5. Cantidades y dinero: `numeric` en BD, `decimal.js` en TS. Nunca `Number`/`parseFloat` para calcular (solo para mostrar).
6. Permisos con `requirePermission` en el servicio, no solo ocultando botones.
7. Operaciones críticas aceptan `idempotencyKey`.

## Reglas para el agente
- No ejecutar migraciones contra bases compartidas ni editar migraciones ya aplicadas; crear una nueva.
- No commitear `.env.local` ni `.local/`. No crear credenciales fijas.
- Todo cambio de dominio llega con pruebas de integración (incluido aislamiento entre empresas si toca datos).
- Terminado = typecheck + lint + `npm test` + build en verde (y E2E si cambia la UI).
