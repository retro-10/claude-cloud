CREATE TYPE "public"."cohort_status" AS ENUM('planning', 'live', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ledger_section" AS ENUM('income', 'fixed_costs', 'variable_costs', 'partner_withdrawals');--> statement-breakpoint
CREATE TYPE "public"."ledger_status" AS ENUM('received', 'expected', 'paid', 'owed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_plan" AS ENUM('one_time', 'installments', 'free_seat');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('active', 'graduated', 'dropped');--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry" text NOT NULL,
	"amount_egp" integer NOT NULL,
	"date" timestamp with time zone,
	"date_approximate" boolean DEFAULT false NOT NULL,
	"section" "ledger_section" NOT NULL,
	"category" text NOT NULL,
	"status" "ledger_status" NOT NULL,
	"partner" text,
	"from_to" text,
	"reference" text,
	"notes" text,
	"enrolment_id" integer,
	"cohort_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notion_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"local_id" integer NOT NULL,
	"page_id" text NOT NULL,
	"notion_edited_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hash" text,
	CONSTRAINT "notion_links_page_id_unique" UNIQUE("page_id")
);
--> statement-breakpoint
CREATE TABLE "notion_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"pushed" integer DEFAULT 0 NOT NULL,
	"pulled" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"conflicts" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cohorts" ADD COLUMN "open_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cohorts" ADD COLUMN "status" "cohort_status" DEFAULT 'planning' NOT NULL;--> statement-breakpoint
ALTER TABLE "cohorts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "discount_egp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "payment_plan" "payment_plan" DEFAULT 'one_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "first_instalment_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "final_instalment_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "status" "student_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_date_idx" ON "ledger_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "ledger_enrolment_idx" ON "ledger_entries" USING btree ("enrolment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notion_links_entity_local_uq" ON "notion_links" USING btree ("entity","local_id");--> statement-breakpoint
-- keep every payment already recorded: each paid enrolment becomes one Received ledger row
INSERT INTO "ledger_entries" ("entry", "amount_egp", "date", "section", "category", "status", "reference", "enrolment_id", "cohort_id", "created_at", "updated_at")
SELECT l."full_name" || ' — payment', e."amount_egp", e."paid_at", 'income', 'Candidate payment', 'received', e."payment_ref", e."id", e."cohort_id", e."paid_at", e."paid_at"
FROM "enrolments" e JOIN "leads" l ON l."id" = e."lead_id" WHERE e."paid_at" IS NOT NULL;--> statement-breakpoint
-- enrolments without a payment keep a reference-only note so nothing is lost
UPDATE "enrolments" SET "notes" = 'Payment reference: ' || "payment_ref" WHERE "paid_at" IS NULL AND "payment_ref" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "enrolments" DROP COLUMN "paid_at";--> statement-breakpoint
ALTER TABLE "enrolments" DROP COLUMN "payment_ref";--> statement-breakpoint
ALTER TABLE "enrolments" DROP COLUMN "gateway";--> statement-breakpoint
DROP TYPE "public"."gateway";