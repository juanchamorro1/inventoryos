CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_role_ck" CHECK ("invitations"."role" in ('owner','admin','manager','staff','viewer')),
	CONSTRAINT "invitations_status_ck" CHECK ("invitations"."status" in ('pending','accepted','revoked')),
	CONSTRAINT "invitations_email_ck" CHECK ("invitations"."email" = lower("invitations"."email"))
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_email_uq" ON "invitations" USING btree ("organization_id",lower("email")) WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("organization_id","created_at");--> statement-breakpoint
-- Coherencia de estados: aceptada ⇒ fecha de aceptación; revocada ⇒ fecha de revocación.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_state_ck" CHECK (
  ("status" <> 'accepted' OR "accepted_at" IS NOT NULL) AND ("status" <> 'revoked' OR "revoked_at" IS NOT NULL)
);
--> statement-breakpoint
-- Permisos del rol de aplicación: las invitaciones no se borran (quedan como historial).
GRANT SELECT, INSERT, UPDATE ON "invitations" TO inventoryos_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "invitations" FROM inventoryos_app;
--> statement-breakpoint
-- Aislamiento multiempresa (igual que el resto de tablas de negocio).
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invitations" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
-- Antes de conocer la empresa, solo es visible la invitación cuyo hash coincide con el token presentado.
CREATE POLICY invitation_token_lookup ON "invitations" FOR SELECT USING (token_hash = nullif(current_setting('app.invite_token_hash', true), ''));
