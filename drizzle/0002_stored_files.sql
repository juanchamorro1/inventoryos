CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_size_ck" CHECK ("stored_files"."size" > 0 and "stored_files"."size" <= 2097152)
);
--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_files_org_idx" ON "stored_files" USING btree ("organization_id");--> statement-breakpoint
-- Aislamiento multiempresa (igual que el resto de tablas de negocio).
ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stored_files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stored_files" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
