import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import "./helpers";

// Las migraciones se aplicaron sobre una base vacía en global-setup.ts.
describe("migraciones y seguridad del esquema", () => {
  it("crea todas las tablas esperadas", async () => {
    const r = await getDb().execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
    const names = r.rows.map((x) => x.table_name);
    for (const t of ["organizations", "users", "products", "product_variants", "stock_movements", "stock_balances", "purchase_orders", "sales", "audit_logs"]) {
      expect(names).toContain(t);
    }
  });

  it("toda tabla con organization_id tiene RLS habilitado, forzado y con política", async () => {
    const r = await getDb().execute<{ relname: string; rls: boolean; force: boolean; policies: number }>(sql`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from information_schema.columns col where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'organization_id')`);
    expect(r.rows.length).toBeGreaterThan(15);
    const bad = r.rows.filter((x) => !x.rls || !x.force || x.policies === 0).map((x) => x.relname);
    expect(bad).toEqual([]);
  });

  it("el rol de la aplicación no es superusuario, no evita RLS y no es dueño de tablas", async () => {
    const [role] = (
      await getDb().execute<{ rolsuper: boolean; rolbypassrls: boolean; owns: number }>(sql`
        select r.rolsuper, r.rolbypassrls,
          (select count(*)::int from pg_tables t where t.schemaname = 'public' and t.tableowner = current_user) as owns
        from pg_roles r where r.rolname = current_user`)
    ).rows;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, owns: 0 });
  });

  it("sin contexto de empresa no se ve ninguna fila de negocio", async () => {
    const r = await getDb().execute<{ n: number }>(sql`select (select count(*) from products) + (select count(*) from organizations) + (select count(*) from stock_movements) as n`);
    expect(Number(r.rows[0]!.n)).toBe(0);
  });
});
