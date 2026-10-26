CREATE TABLE "business_functions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"applies_to" text DEFAULT 'both' NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"description" text,
	"accountable" text,
	"supporting" text[] DEFAULT '{}'::text[] NOT NULL,
	"staff" text,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cycle_closes" (
	"id" serial PRIMARY KEY NOT NULL,
	"close_date" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"closed_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner" text NOT NULL,
	"kind" text NOT NULL,
	"amount_egp" integer NOT NULL,
	"month" text,
	"note" text,
	"cycle_close_id" integer,
	"ledger_entry_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"partner" text NOT NULL,
	"kpi_score" integer NOT NULL,
	"notes" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"approved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_runs_month_unique" UNIQUE("month")
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "stream" text DEFAULT 'camp' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_functions" ADD CONSTRAINT "business_functions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_closes" ADD CONSTRAINT "cycle_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_movements" ADD CONSTRAINT "legacy_movements_cycle_close_id_cycle_closes_id_fk" FOREIGN KEY ("cycle_close_id") REFERENCES "public"."cycle_closes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_movements" ADD CONSTRAINT "legacy_movements_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_movements" ADD CONSTRAINT "legacy_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_reviews" ADD CONSTRAINT "partner_reviews_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legacy_partner_idx" ON "legacy_movements" USING btree ("partner");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_reviews_month_partner_uq" ON "partner_reviews" USING btree ("month","partner");--> statement-breakpoint
-- existing rows: design house income and designer pay belong to Core
UPDATE "ledger_entries" SET "stream" = 'core' WHERE "category" IN ('OrlaDent client work', 'Production designers') OR "invoice_id" IS NOT NULL OR "case_id" IS NOT NULL;
