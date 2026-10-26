CREATE TABLE "price_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"old_price" numeric(20, 4),
	"new_price" numeric(20, 4),
	"old_mode" text NOT NULL,
	"new_mode" text NOT NULL,
	"source" text NOT NULL,
	"suggested_price" numeric(20, 4),
	"rate" numeric(18, 6),
	"reason" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_history_kind_ck" CHECK ("price_history"."kind" in ('retail','wholesale')),
	CONSTRAINT "price_history_source_ck" CHECK ("price_history"."source" in ('auto','approval','manual','revert','import'))
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_driver" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "product_images_size_ck" CHECK ("product_images"."size" > 0),
	CONSTRAINT "product_images_driver_ck" CHECK ("product_images"."storage_driver" in ('database','s3'))
);
--> statement-breakpoint
CREATE TABLE "exchange_rate_fetches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exchange_rate_fetches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"rate_id" bigint,
	"trigger" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rate_fetches_status_ck" CHECK ("exchange_rate_fetches"."status" in ('stored','unchanged','rejected','error'))
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exchange_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"base_currency" text DEFAULT 'COP' NOT NULL,
	"quote_currency" text DEFAULT 'USD' NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"provider" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	CONSTRAINT "exchange_rates_rate_ck" CHECK ("exchange_rates"."rate" > 0 and "exchange_rates"."valid_from" <= "exchange_rates"."valid_to")
);
--> statement-breakpoint
CREATE TABLE "manual_exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"valid_from" date NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_exchange_rates_rate_ck" CHECK ("manual_exchange_rates"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"fx_adjustment_cop" numeric(20, 4) DEFAULT '100' NOT NULL,
	"retail_margin" numeric(7, 4) DEFAULT '30' NOT NULL,
	"wholesale_margin" numeric(7, 4) DEFAULT '20' NOT NULL,
	"extra_cost_percent" numeric(7, 4) DEFAULT '0' NOT NULL,
	"rounding_step" numeric(20, 4) DEFAULT '100' NOT NULL,
	"rounding_mode" text DEFAULT 'up' NOT NULL,
	"apply_policy" text DEFAULT 'approval' NOT NULL,
	"rate_mode" text DEFAULT 'auto' NOT NULL,
	"max_rate_age_hours" integer DEFAULT 48 NOT NULL,
	"last_rate_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "pricing_settings_margins_ck" CHECK ("pricing_settings"."retail_margin" >= 0 and "pricing_settings"."retail_margin" < 100 and "pricing_settings"."wholesale_margin" >= 0 and "pricing_settings"."wholesale_margin" < 100),
	CONSTRAINT "pricing_settings_values_ck" CHECK ("pricing_settings"."fx_adjustment_cop" >= 0 and "pricing_settings"."extra_cost_percent" >= 0 and "pricing_settings"."extra_cost_percent" <= 1000 and "pricing_settings"."rounding_step" > 0 and "pricing_settings"."max_rate_age_hours" between 1 and 720),
	CONSTRAINT "pricing_settings_modes_ck" CHECK ("pricing_settings"."rounding_mode" in ('up','nearest','none') and "pricing_settings"."apply_policy" in ('auto','approval') and "pricing_settings"."rate_mode" in ('auto','manual'))
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "retail_margin" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "wholesale_margin" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "reference_code" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "cost_amount" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "cost_currency" text DEFAULT 'COP' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "extra_cost_cop" numeric(20, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "retail_price_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "wholesale_price" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "wholesale_price_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "wholesale_min_qty" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "suggested_retail_price" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "suggested_wholesale_price" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "pricing_status" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "pricing_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "pricing_rate_date" date;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "pricing_rate_source" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "pricing_cost_cop" numeric(20, 6);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "pricing_total_cost" numeric(20, 6);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "pricing_retail_margin" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "pricing_wholesale_margin" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "pricing_calculated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "retail_margin" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "wholesale_margin" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_fetches" ADD CONSTRAINT "exchange_rate_fetches_rate_id_exchange_rates_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."exchange_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate_fetches" ADD CONSTRAINT "exchange_rate_fetches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_exchange_rates" ADD CONSTRAINT "manual_exchange_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_exchange_rates" ADD CONSTRAINT "manual_exchange_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_history_variant_idx" ON "price_history" USING btree ("organization_id","variant_id","created_at");--> statement-breakpoint
CREATE INDEX "price_history_org_idx" ON "price_history" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("organization_id","product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_primary_uq" ON "product_images" USING btree ("organization_id","product_id") WHERE "product_images"."is_primary";--> statement-breakpoint
CREATE INDEX "exchange_rate_fetches_created_idx" ON "exchange_rate_fetches" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_provider_valid_uq" ON "exchange_rates" USING btree ("provider","quote_currency","valid_from");--> statement-breakpoint
CREATE INDEX "exchange_rates_latest_idx" ON "exchange_rates" USING btree ("quote_currency","valid_from");--> statement-breakpoint
CREATE INDEX "manual_exchange_rates_org_idx" ON "manual_exchange_rates" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "product_variants_reference_idx" ON "product_variants" USING btree ("organization_id",lower("reference_code"));--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_margins_ck" CHECK (("categories"."retail_margin" is null or ("categories"."retail_margin" >= 0 and "categories"."retail_margin" < 100)) and ("categories"."wholesale_margin" is null or ("categories"."wholesale_margin" >= 0 and "categories"."wholesale_margin" < 100)));--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_cost_ck" CHECK ("product_variants"."cost_amount" >= 0 and "product_variants"."extra_cost_cop" >= 0 and "product_variants"."cost_currency" in ('COP','USD'));--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_modes_ck" CHECK ("product_variants"."retail_price_mode" in ('auto','manual') and "product_variants"."wholesale_price_mode" in ('auto','manual'));--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_wholesale_ck" CHECK (("product_variants"."wholesale_price" is null or "product_variants"."wholesale_price" >= 0) and ("product_variants"."wholesale_min_qty" is null or "product_variants"."wholesale_min_qty" > 0));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_margins_ck" CHECK (("products"."retail_margin" is null or ("products"."retail_margin" >= 0 and "products"."retail_margin" < 100)) and ("products"."wholesale_margin" is null or ("products"."wholesale_margin" >= 0 and "products"."wholesale_margin" < 100)));--> statement-breakpoint
-- Proveedor habitual del producto: FK compuesta para no poder referenciar proveedores de otra empresa.
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "products_supplier_idx" ON "products" USING btree ("organization_id","supplier_id") WHERE "supplier_id" IS NOT NULL;
--> statement-breakpoint

-- ===== Relleno de datos existentes =====
-- RLS forzado también aplica al dueño del esquema: sin quitar FORCE, estos UPDATE/INSERT no verían ninguna fila.
-- Se quita FORCE solo durante esta transacción de migración (las tablas quedan bloqueadas hasta el COMMIT).
ALTER TABLE "product_variants" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Los precios actuales los fijaron personas: quedan en modo MANUAL para que ningún cálculo los cambie en silencio.
-- El costo de referencia actual (COP) pasa a ser el costo original en COP.
UPDATE "product_variants" SET "cost_amount" = "cost_price", "cost_currency" = 'COP', "retail_price_mode" = 'manual';
--> statement-breakpoint
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stored_files" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- La foto única anterior (products.image_path = 'files/<uuid>') pasa a ser la foto principal en product_images.
INSERT INTO "product_images" ("organization_id","product_id","storage_driver","storage_key","content_type","size","alt_text","position","is_primary","created_at")
SELECT p."organization_id", p."id", 'database', f."id"::text, f."content_type", f."size", p."name", 0, true, f."created_at"
FROM "products" p
JOIN "stored_files" f ON f."organization_id" = p."organization_id" AND p."image_path" = 'files/' || f."id"::text;
--> statement-breakpoint
ALTER TABLE "stored_files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ===== Aislamiento multiempresa de las tablas nuevas =====
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_images" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "product_images" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "price_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "price_history" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "price_history" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "pricing_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pricing_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pricing_settings" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "manual_exchange_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "manual_exchange_rates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "manual_exchange_rates" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint

-- ===== Permisos del rol de aplicación =====
-- Historiales de solo inserción (también frente al dueño, con triggers).
REVOKE UPDATE, DELETE, TRUNCATE ON "price_history", "manual_exchange_rates", "exchange_rates", "exchange_rate_fetches" FROM inventoryos_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "price_history", "manual_exchange_rates", "exchange_rates", "exchange_rate_fetches" TO inventoryos_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "pricing_settings" FROM inventoryos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "pricing_settings" TO inventoryos_app;
--> statement-breakpoint
REVOKE TRUNCATE ON "product_images" FROM inventoryos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_images" TO inventoryos_app;
--> statement-breakpoint
CREATE TRIGGER price_history_immutable BEFORE UPDATE OR DELETE ON price_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER manual_exchange_rates_immutable BEFORE UPDATE OR DELETE ON manual_exchange_rates FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER exchange_rates_immutable BEFORE UPDATE OR DELETE ON exchange_rates FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER exchange_rate_fetches_immutable BEFORE UPDATE OR DELETE ON exchange_rate_fetches FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
