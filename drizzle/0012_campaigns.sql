CREATE TYPE "public"."campaign_kind" AS ENUM('masterclass', 'ads', 'collaboration', 'organic', 'event', 'referral', 'other');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('planned', 'live', 'ended');--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "kind" "campaign_kind" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "status" "campaign_status" DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "budget_egp" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "campaign_id" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_slug_unique" UNIQUE("slug");