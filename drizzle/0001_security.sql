-- Seguridad multiempresa e inmutabilidad del ledger.
-- La aplicación se conecta como inventoryos_app (sin BYPASSRLS, no es dueño de las tablas).
-- El contexto se fija por transacción con set_config('app.org_id', ..., true).

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- Permisos del rol de aplicación.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO inventoryos_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO inventoryos_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_org(), app_current_user() TO inventoryos_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inventoryos_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO inventoryos_app;
--> statement-breakpoint
-- Tablas de solo inserción: la aplicación no puede modificarlas ni borrarlas.
REVOKE UPDATE, DELETE, TRUNCATE ON stock_documents, stock_movements, audit_logs FROM inventoryos_app;
--> statement-breakpoint
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM inventoryos_app;
--> statement-breakpoint

-- Row-Level Security en toda tabla con organization_id (FORCE: aplica también al dueño).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org())',
      r.table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- organizations: la fila de la empresa activa, y lectura de las empresas donde el usuario es miembro activo.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_self ON organizations USING (id = app_current_org()) WITH CHECK (id = app_current_org());
--> statement-breakpoint
CREATE POLICY org_member_read ON organizations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = organizations.id AND m.user_id = app_current_user() AND m.status = 'active'
  )
);
--> statement-breakpoint
-- memberships: cada usuario puede ver sus propias membresías (para elegir empresa al iniciar sesión).
CREATE POLICY membership_self_read ON memberships FOR SELECT USING (user_id = app_current_user());
--> statement-breakpoint
-- api_keys: solo es visible la fila cuyo hash coincide con el presentado (resolución de la clave antes de conocer la empresa).
CREATE POLICY api_key_lookup ON api_keys FOR SELECT USING (key_hash = nullif(current_setting('app.api_key_hash', true), ''));
--> statement-breakpoint

-- Inmutabilidad del ledger y de la auditoría (también frente al dueño del esquema).
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción: registre un movimiento compensatorio', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER stock_documents_immutable BEFORE UPDATE OR DELETE ON stock_documents FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER stock_documents_no_truncate BEFORE TRUNCATE ON stock_documents FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
