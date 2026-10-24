CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"origin" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_origin_ck" CHECK ("password_reset_tokens"."origin" in ('self','platform'))
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "platform_audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_uq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_logs_target_idx" ON "platform_audit_logs" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
-- Compatibilidad con datos existentes: una cuenta ya inactiva queda registrada como bloqueada.
UPDATE "users" SET "blocked_at" = now(), "blocked_reason" = 'Inactiva antes de la migración 0004' WHERE "is_active" = false AND "blocked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_blocked_ck" CHECK ("users"."is_active" = ("users"."blocked_at" is null));--> statement-breakpoint
-- Permisos del rol de aplicación (los privilegios por defecto otorgan todo; aquí se recortan).
-- platform_admins: la aplicación solo puede leer. Otorgar o retirar se hace con el rol dueño (npm run platform:admin).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "platform_admins" FROM inventoryos_app;
--> statement-breakpoint
GRANT SELECT ON "platform_admins" TO inventoryos_app;
--> statement-breakpoint
-- platform_audit_logs: solo inserción y lectura.
REVOKE UPDATE, DELETE, TRUNCATE ON "platform_audit_logs" FROM inventoryos_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "platform_audit_logs" TO inventoryos_app;
--> statement-breakpoint
CREATE TRIGGER platform_audit_logs_immutable BEFORE UPDATE OR DELETE ON platform_audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER platform_audit_logs_no_truncate BEFORE TRUNCATE ON platform_audit_logs FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- password_reset_tokens: se marcan como usados o revocados, nunca se borran desde la aplicación.
REVOKE DELETE, TRUNCATE ON "password_reset_tokens" FROM inventoryos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "password_reset_tokens" TO inventoryos_app;
--> statement-breakpoint
-- rate_limits: contadores; la aplicación depura las ventanas viejas.
GRANT SELECT, INSERT, UPDATE, DELETE ON "rate_limits" TO inventoryos_app;
--> statement-breakpoint
REVOKE TRUNCATE ON "rate_limits" FROM inventoryos_app;
