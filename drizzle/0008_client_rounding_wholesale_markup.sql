ALTER TABLE "product_variants" ADD COLUMN "wholesale_markup_type" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "wholesale_markup_value" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "pricing_settings" ADD COLUMN "round_client_price" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_settings" ADD COLUMN "client_price_step" numeric(20, 4) DEFAULT '100' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_wholesale_markup_ck" CHECK (("product_variants"."wholesale_markup_type" is null or "product_variants"."wholesale_markup_type" in ('amount','percent')) and ("product_variants"."wholesale_markup_value" is null or "product_variants"."wholesale_markup_value" >= 0));--> statement-breakpoint
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_client_step_ck" CHECK ("pricing_settings"."client_price_step" > 0);