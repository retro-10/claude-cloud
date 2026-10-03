CREATE TYPE "public"."availability" AS ENUM('open', 'busy', 'not_looking');--> statement-breakpoint
CREATE TABLE "alumni_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"headline" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"availability" "availability" DEFAULT 'open' NOT NULL,
	"portfolio_url" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alumni_profiles_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"enrolment_id" integer NOT NULL,
	"code" text NOT NULL,
	"full_name" text NOT NULL,
	"programme" text NOT NULL,
	"batch" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" integer,
	"override" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" integer,
	"revoke_reason" text,
	CONSTRAINT "certificates_enrolment_id_unique" UNIQUE("enrolment_id"),
	CONSTRAINT "certificates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "cohorts" ADD COLUMN "grad_min_attendance_pct" integer DEFAULT 75 NOT NULL;--> statement-breakpoint
ALTER TABLE "cohorts" ADD COLUMN "grad_require_all_passed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cohorts" ADD COLUMN "grad_require_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alumni_profiles" ADD CONSTRAINT "alumni_profiles_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;