ALTER TABLE "invitations" ADD COLUMN "platform_issued" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "business_type" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_business_type_ck" CHECK ("organizations"."business_type" in ('cosmetics','electronics','general'));