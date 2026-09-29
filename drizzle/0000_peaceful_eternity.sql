CREATE TYPE "public"."activity_type" AS ENUM('whatsapp', 'call', 'instagram', 'linkedin', 'email', 'note', 'consult');--> statement-breakpoint
CREATE TYPE "public"."consult_outcome" AS ENUM('enrolled', 'thinking', 'not_fit', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('out', 'in', 'internal');--> statement-breakpoint
CREATE TYPE "public"."gateway" AS ENUM('paymob', 'other');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'sales', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."segment" AS ENUM('fresh_graduate', 'technician', 'dentist', 'other');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('open', 'won', 'lost', 'nurture');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('foundation', 'freelance_ready', 'production_partner');--> statement-breakpoint
CREATE TYPE "public"."tier_interest" AS ENUM('foundation', 'freelance_ready', 'production_partner', 'unsure');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"type" "activity_type" NOT NULL,
	"direction" "direction" DEFAULT 'internal' NOT NULL,
	"body" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user_id" integer,
	"external_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"entity" text NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"diff" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cadence_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"steps" jsonb NOT NULL,
	CONSTRAINT "cadence_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"source_id" integer,
	"started_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cohorts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"masterclass_at" timestamp with time zone,
	"enrolment_close_at" timestamp with time zone,
	"seat_cap" integer NOT NULL,
	"start_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consult_objections" (
	"consult_id" integer NOT NULL,
	"objection_id" integer NOT NULL,
	CONSTRAINT "consult_objections_consult_id_objection_id_pk" PRIMARY KEY("consult_id","objection_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consults" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"held" boolean DEFAULT false NOT NULL,
	"outcome" "consult_outcome",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrolments" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"cohort_id" integer NOT NULL,
	"tier" "tier" NOT NULL,
	"amount_egp" integer NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_ref" text,
	"gateway" "gateway" DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "follow_ups" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"kind" text DEFAULT 'whatsapp' NOT NULL,
	"note" text,
	"done_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" integer,
	"template_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"phone_whatsapp" text,
	"email" text,
	"city" text,
	"segment" "segment",
	"source_id" integer,
	"campaign_id" integer,
	"tier_interest" "tier_interest" DEFAULT 'unsure' NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"owner_id" integer,
	"notes" text,
	"lost_reason_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_contact_at" timestamp with time zone,
	"first_reply_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "leads_phone_whatsapp_unique" UNIQUE("phone_whatsapp")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lost_reasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "lost_reasons_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "objections" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "objections_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "sources_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"kind" "stage_kind" DEFAULT 'open' NOT NULL,
	CONSTRAINT "stages_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'sales' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consult_objections" ADD CONSTRAINT "consult_objections_consult_id_consults_id_fk" FOREIGN KEY ("consult_id") REFERENCES "public"."consults"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consult_objections" ADD CONSTRAINT "consult_objections_objection_id_objections_id_fk" FOREIGN KEY ("objection_id") REFERENCES "public"."objections"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consults" ADD CONSTRAINT "consults_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_template_id_cadence_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."cadence_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_stages_key_fk" FOREIGN KEY ("stage") REFERENCES "public"."stages"("key") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_lost_reason_id_lost_reasons_id_fk" FOREIGN KEY ("lost_reason_id") REFERENCES "public"."lost_reasons"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stage_events" ADD CONSTRAINT "stage_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stage_events" ADD CONSTRAINT "stage_events_from_stage_stages_key_fk" FOREIGN KEY ("from_stage") REFERENCES "public"."stages"("key") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stage_events" ADD CONSTRAINT "stage_events_to_stage_stages_key_fk" FOREIGN KEY ("to_stage") REFERENCES "public"."stages"("key") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stage_events" ADD CONSTRAINT "stage_events_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_lead_at_idx" ON "activities" USING btree ("lead_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consults_lead_idx" ON "consults" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consults_scheduled_idx" ON "consults" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enrolments_lead_cohort_uq" ON "enrolments" USING btree ("lead_id","cohort_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrolments_cohort_idx" ON "enrolments" USING btree ("cohort_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_ups_due_at_idx" ON "follow_ups" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_ups_lead_idx" ON "follow_ups" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_stage_idx" ON "leads" USING btree ("stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_owner_idx" ON "leads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_created_at_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_source_idx" ON "leads" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leads_email_lower_uq" ON "leads" USING btree (lower("email")) WHERE "leads"."email" is not null and "leads"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_deleted_at_idx" ON "leads" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stage_events_lead_idx" ON "stage_events" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stage_events_to_stage_at_idx" ON "stage_events" USING btree ("to_stage","at");