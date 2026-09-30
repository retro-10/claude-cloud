CREATE TABLE "programme_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enrolment_id" integer,
	"type" text,
	"day_of_week" text,
	"time" text,
	"recorded" boolean DEFAULT false NOT NULL,
	"drive_link" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "proof_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enrolment_id" integer,
	"type" text,
	"consent_status" text,
	"usable_in" text[] DEFAULT '{}'::text[] NOT NULL,
	"file_or_link" text,
	"quote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"group" text,
	"status" text,
	"contact" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "content_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "content_consent_scope" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "qc_score" real;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "leaderboard_rank" integer;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "team_member_id" integer;--> statement-breakpoint
ALTER TABLE "programme_sessions" ADD CONSTRAINT "programme_sessions_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_items" ADD CONSTRAINT "proof_items_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "programme_sessions_enrolment_idx" ON "programme_sessions" USING btree ("enrolment_id");--> statement-breakpoint
CREATE INDEX "proof_items_enrolment_idx" ON "proof_items" USING btree ("enrolment_id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;