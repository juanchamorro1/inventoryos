CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_api_key_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"next_value" bigint NOT NULL,
	CONSTRAINT "document_sequences_organization_id_key_pk" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"result_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_organization_id_key_pk" PRIMARY KEY("organization_id","key"),
	CONSTRAINT "idempotency_key_len_ck" CHECK (length("idempotency_keys"."key") between 8 and 200)
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"ip" text,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "memberships_role_ck" CHECK ("memberships"."role" in ('owner','admin','manager','staff','viewer')),
	CONSTRAINT "memberships_status_ck" CHECK ("memberships"."status" in ('active','disabled'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"currency" text DEFAULT 'COP' NOT NULL,
	"timezone" text DEFAULT 'America/Bogota' NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_plan_ck" CHECK ("organizations"."plan" in ('free','pro','enterprise')),
	CONSTRAINT "organizations_currency_ck" CHECK ("organizations"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name" text DEFAULT '' NOT NULL,
	"option_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_price" numeric(20, 6) DEFAULT '0' NOT NULL,
	"sale_price" numeric(20, 4) DEFAULT '0' NOT NULL,
	"low_stock_threshold" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "product_variants_status_ck" CHECK ("product_variants"."status" in ('active','archived')),
	CONSTRAINT "product_variants_prices_ck" CHECK ("product_variants"."cost_price" >= 0 and "product_variants"."sale_price" >= 0 and "product_variants"."low_stock_threshold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" uuid,
	"brand_id" uuid,
	"tax_rate_id" uuid,
	"unit" text DEFAULT 'unidad' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"image_path" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "products_status_ck" CHECK ("products"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(7, 4) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rates_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "tax_rates_rate_ck" CHECK ("tax_rates"."rate" >= 0 and "tax_rates"."rate" <= 100)
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "locations_org_wh_id_uq" UNIQUE("organization_id","warehouse_id","id"),
	CONSTRAINT "locations_status_ck" CHECK ("locations"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "warehouses_status_ck" CHECK ("warehouses"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"organization_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"on_hand" numeric(18, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_organization_id_variant_id_location_id_pk" PRIMARY KEY("organization_id","variant_id","location_id"),
	CONSTRAINT "stock_balances_non_negative_ck" CHECK ("stock_balances"."on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"type" text NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"source_type" text,
	"source_id" uuid,
	"reverses_document_id" uuid,
	"created_by" uuid NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_documents_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "stock_documents_type_ck" CHECK ("stock_documents"."type" in ('opening','receipt','issue','adjustment','transfer','purchase_receipt','purchase_receipt_reversal','sale','sale_return','sale_cancellation','reversal')),
	CONSTRAINT "stock_documents_reason_ck" CHECK (length(trim("stock_documents"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(20, 6) NOT NULL,
	"total_cost" numeric(20, 4) NOT NULL,
	"location_qty_after" numeric(18, 4) NOT NULL,
	"warehouse_qty_after" numeric(18, 4) NOT NULL,
	"warehouse_value_after" numeric(20, 4) NOT NULL,
	"avg_cost_after" numeric(20, 6) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_doc_line_uq" UNIQUE("organization_id","document_id","line_no"),
	CONSTRAINT "stock_movements_qty_ck" CHECK ("stock_movements"."quantity" <> 0),
	CONSTRAINT "stock_movements_sign_ck" CHECK (sign("stock_movements"."total_cost") in (0, sign("stock_movements"."quantity"))),
	CONSTRAINT "stock_movements_after_ck" CHECK ("stock_movements"."location_qty_after" >= 0 and "stock_movements"."warehouse_qty_after" >= 0 and "stock_movements"."warehouse_value_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_valuations" (
	"organization_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_value" numeric(20, 4) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_valuations_organization_id_variant_id_warehouse_id_pk" PRIMARY KEY("organization_id","variant_id","warehouse_id"),
	CONSTRAINT "stock_valuations_non_negative_ck" CHECK ("stock_valuations"."quantity" >= 0 and "stock_valuations"."total_value" >= 0 and "stock_valuations"."avg_cost" >= 0),
	CONSTRAINT "stock_valuations_zero_ck" CHECK ("stock_valuations"."quantity" > 0 or "stock_valuations"."total_value" = 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(20, 6) NOT NULL,
	CONSTRAINT "goods_receipt_lines_qty_ck" CHECK ("goods_receipt_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"stock_document_id" uuid NOT NULL,
	"reversal_document_id" uuid,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "goods_receipts_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity_ordered" numeric(18, 4) NOT NULL,
	"quantity_received" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(20, 6) NOT NULL,
	"tax_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "purchase_order_lines_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_order_lines_qty_ck" CHECK ("purchase_order_lines"."quantity_ordered" > 0 and "purchase_order_lines"."quantity_received" >= 0 and "purchase_order_lines"."quantity_received" <= "purchase_order_lines"."quantity_ordered"),
	CONSTRAINT "purchase_order_lines_cost_ck" CHECK ("purchase_order_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected_date" date,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ordered_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "purchase_orders_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_orders_status_ck" CHECK ("purchase_orders"."status" in ('draft','ordered','partially_received','received','closed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "suppliers_status_ck" CHECK ("suppliers"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"document_number" text,
	"email" text,
	"phone" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "customers_status_ck" CHECK ("customers"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"quantity_returned" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 4) NOT NULL,
	"discount" numeric(20, 4) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(7, 4) NOT NULL,
	"line_subtotal" numeric(20, 4) NOT NULL,
	"line_tax" numeric(20, 4) NOT NULL,
	"line_total" numeric(20, 4) NOT NULL,
	"unit_cost" numeric(20, 6) NOT NULL,
	"line_cost" numeric(20, 4) NOT NULL,
	CONSTRAINT "sale_lines_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "sale_lines_qty_ck" CHECK ("sale_lines"."quantity" > 0 and "sale_lines"."quantity_returned" >= 0 and "sale_lines"."quantity_returned" <= "sale_lines"."quantity"),
	CONSTRAINT "sale_lines_amounts_ck" CHECK ("sale_lines"."unit_price" >= 0 and "sale_lines"."discount" >= 0 and "sale_lines"."line_subtotal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sale_return_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(20, 6) NOT NULL,
	"refund_amount" numeric(20, 4) NOT NULL,
	CONSTRAINT "sale_return_lines_qty_ck" CHECK ("sale_return_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"refund_total" numeric(20, 4) NOT NULL,
	"stock_document_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_returns_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"subtotal" numeric(20, 4) NOT NULL,
	"discount_total" numeric(20, 4) NOT NULL,
	"tax_total" numeric(20, 4) NOT NULL,
	"total" numeric(20, 4) NOT NULL,
	"cost_total" numeric(20, 4) NOT NULL,
	"payment_method" text NOT NULL,
	"notes" text,
	"stock_document_id" uuid NOT NULL,
	"cancellation_document_id" uuid,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "sales_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "sales_status_ck" CHECK ("sales"."status" in ('confirmed','partially_returned','returned','cancelled')),
	CONSTRAINT "sales_payment_ck" CHECK ("sales"."payment_method" in ('cash','card','transfer','credit','other'))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_fk" FOREIGN KEY ("organization_id","brand_id") REFERENCES "public"."brands"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_rate_fk" FOREIGN KEY ("organization_id","tax_rate_id") REFERENCES "public"."tax_rates"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_fk" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_fk" FOREIGN KEY ("organization_id","warehouse_id","location_id") REFERENCES "public"."locations"("organization_id","warehouse_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_reverses_fk" FOREIGN KEY ("organization_id","reverses_document_id") REFERENCES "public"."stock_documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_document_fk" FOREIGN KEY ("organization_id","document_id") REFERENCES "public"."stock_documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_fk" FOREIGN KEY ("organization_id","warehouse_id","location_id") REFERENCES "public"."locations"("organization_id","warehouse_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_valuations" ADD CONSTRAINT "stock_valuations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_valuations" ADD CONSTRAINT "stock_valuations_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_valuations" ADD CONSTRAINT "stock_valuations_warehouse_fk" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_fk" FOREIGN KEY ("organization_id","goods_receipt_id") REFERENCES "public"."goods_receipts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_fk" FOREIGN KEY ("organization_id","purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "public"."purchase_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_location_fk" FOREIGN KEY ("organization_id","warehouse_id","location_id") REFERENCES "public"."locations"("organization_id","warehouse_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_doc_fk" FOREIGN KEY ("organization_id","stock_document_id") REFERENCES "public"."stock_documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_rev_doc_fk" FOREIGN KEY ("organization_id","reversal_document_id") REFERENCES "public"."stock_documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "public"."purchase_orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_fk" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_fk" FOREIGN KEY ("organization_id","sale_id") REFERENCES "public"."sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_return_fk" FOREIGN KEY ("organization_id","sale_return_id") REFERENCES "public"."sale_returns"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_line_fk" FOREIGN KEY ("organization_id","sale_line_id") REFERENCES "public"."sale_lines"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_fk" FOREIGN KEY ("organization_id","sale_id") REFERENCES "public"."sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_doc_fk" FOREIGN KEY ("organization_id","stock_document_id") REFERENCES "public"."stock_documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_location_fk" FOREIGN KEY ("organization_id","warehouse_id","location_id") REFERENCES "public"."locations"("organization_id","warehouse_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_doc_fk" FOREIGN KEY ("organization_id","stock_document_id") REFERENCES "public"."stock_documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cancel_doc_fk" FOREIGN KEY ("organization_id","cancellation_document_id") REFERENCES "public"."stock_documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "brands_org_name_uq" ON "brands" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "categories_org_name_uq" ON "categories" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_org_sku_uq" ON "product_variants" USING btree ("organization_id",lower("sku"));--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_org_barcode_uq" ON "product_variants" USING btree ("organization_id","barcode") WHERE "product_variants"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("organization_id","product_id");--> statement-breakpoint
CREATE INDEX "products_org_name_idx" ON "products" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rates_org_name_uq" ON "tax_rates" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "locations_org_wh_code_uq" ON "locations" USING btree ("organization_id","warehouse_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_org_code_uq" ON "warehouses" USING btree ("organization_id",lower("code"));--> statement-breakpoint
CREATE INDEX "stock_balances_wh_idx" ON "stock_balances" USING btree ("organization_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_documents_org_number_uq" ON "stock_documents" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_documents_reverses_uq" ON "stock_documents" USING btree ("organization_id","reverses_document_id") WHERE "stock_documents"."reverses_document_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_documents_org_posted_idx" ON "stock_documents" USING btree ("organization_id","posted_at");--> statement-breakpoint
CREATE INDEX "stock_documents_source_idx" ON "stock_documents" USING btree ("organization_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "stock_movements_variant_idx" ON "stock_movements" USING btree ("organization_id","variant_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_created_idx" ON "stock_movements" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_receipt_idx" ON "goods_receipt_lines" USING btree ("organization_id","goods_receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_org_number_uq" ON "goods_receipts" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("organization_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_po_idx" ON "purchase_order_lines" USING btree ("organization_id","purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_org_number_uq" ON "purchase_orders" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "purchase_orders_org_status_idx" ON "purchase_orders" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_org_tax_uq" ON "suppliers" USING btree ("organization_id","tax_id") WHERE "suppliers"."tax_id" is not null;--> statement-breakpoint
CREATE INDEX "suppliers_org_name_idx" ON "suppliers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_doc_uq" ON "customers" USING btree ("organization_id","document_number") WHERE "customers"."document_number" is not null;--> statement-breakpoint
CREATE INDEX "customers_org_name_idx" ON "customers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "sale_lines_sale_idx" ON "sale_lines" USING btree ("organization_id","sale_id");--> statement-breakpoint
CREATE INDEX "sale_lines_variant_idx" ON "sale_lines" USING btree ("organization_id","variant_id");--> statement-breakpoint
CREATE INDEX "sale_return_lines_return_idx" ON "sale_return_lines" USING btree ("organization_id","sale_return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_org_number_uq" ON "sale_returns" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "sale_returns_sale_idx" ON "sale_returns" USING btree ("organization_id","sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_org_number_uq" ON "sales" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "sales_org_created_idx" ON "sales" USING btree ("organization_id","created_at");