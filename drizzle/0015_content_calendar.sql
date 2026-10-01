CREATE TYPE "public"."content_format" AS ENUM('reel', 'post', 'carousel', 'story', 'live', 'video', 'broadcast', 'other');--> statement-breakpoint
CREATE TYPE "public"."content_platform" AS ENUM('instagram', 'tiktok', 'facebook', 'youtube', 'linkedin', 'whatsapp', 'other');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('idea', 'scripting', 'filming', 'editing', 'scheduled', 'posted');--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"platform" "content_platform" DEFAULT 'instagram' NOT NULL,
	"format" "content_format" DEFAULT 'reel' NOT NULL,
	"status" "content_status" DEFAULT 'idea' NOT NULL,
	"owner_id" integer,
	"publish_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"campaign_id" integer,
	"proof_item_id" integer,
	"brief" text,
	"caption" text,
	"post_url" text,
	"tag" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "content_items_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_proof_item_id_proof_items_id_fk" FOREIGN KEY ("proof_item_id") REFERENCES "public"."proof_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_publish_idx" ON "content_items" USING btree ("publish_at");--> statement-breakpoint
CREATE INDEX "content_status_idx" ON "content_items" USING btree ("status");