CREATE TYPE "public"."lost_reason_kind" AS ENUM('explicit', 'no_decision');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"granted" boolean NOT NULL,
	"method" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "lead_merges" (
	"id" serial PRIMARY KEY NOT NULL,
	"survivor_id" integer NOT NULL,
	"loser_id" integer NOT NULL,
	"survivor_before" jsonb NOT NULL,
	"loser_before" jsonb NOT NULL,
	"moved" jsonb NOT NULL,
	"by_user_id" integer,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"language" text DEFAULT 'ar' NOT NULL,
	"body" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"lead_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stage_exit_criteria" (
	"id" serial PRIMARY KEY NOT NULL,
	"stage_key" text NOT NULL,
	"check_key" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_rules_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"lead_id" integer,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL,
	"dedupe_key" text,
	CONSTRAINT "workflow_runs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "template_id" integer;--> statement-breakpoint
ALTER TABLE "consults" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consults" ADD COLUMN "recommended_tier" "tier";--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "rule_id" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "phone_raw" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "offer_tier" "tier";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "offer_amount_egp" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "offer_payment_link" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "offer_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "decision_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "do_not_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "merged_into_id" integer;--> statement-breakpoint
ALTER TABLE "lost_reasons" ADD COLUMN "kind" "lost_reason_kind" DEFAULT 'explicit' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_merges" ADD CONSTRAINT "lead_merges_survivor_id_leads_id_fk" FOREIGN KEY ("survivor_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_merges" ADD CONSTRAINT "lead_merges_loser_id_leads_id_fk" FOREIGN KEY ("loser_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_merges" ADD CONSTRAINT "lead_merges_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_exit_criteria" ADD CONSTRAINT "stage_exit_criteria_stage_key_stages_key_fk" FOREIGN KEY ("stage_key") REFERENCES "public"."stages"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_rule_id_workflow_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."workflow_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_lead_idx" ON "consent_records" USING btree ("lead_id","at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_exit_criteria_uq" ON "stage_exit_criteria" USING btree ("stage_key","check_key");--> statement-breakpoint
CREATE INDEX "workflow_runs_fired_at_idx" ON "workflow_runs" USING btree ("fired_at");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_rule_id_workflow_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."workflow_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_tags_idx" ON "leads" USING gin ("tags");