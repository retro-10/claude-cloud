CREATE TYPE "public"."case_status" AS ENUM('received', 'assigned', 'designing', 'qc', 'delivered', 'invoiced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."client_kind" AS ENUM('clinic', 'lab', 'other');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'void');--> statement-breakpoint
CREATE TABLE "case_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit_price_egp" integer NOT NULL,
	"designer_pay_egp" integer DEFAULT 0 NOT NULL,
	"standard_days" integer DEFAULT 2 NOT NULL,
	"rush_days" integer DEFAULT 1 NOT NULL,
	"rush_surcharge_pct" integer DEFAULT 50 NOT NULL,
	"qc_checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"client_id" integer NOT NULL,
	"client_name" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"total_egp" integer NOT NULL,
	"lines" jsonb NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"notes" text,
	"void_reason" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "production_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"case_type_id" integer NOT NULL,
	"reference" text,
	"units" integer DEFAULT 1 NOT NULL,
	"rush" boolean DEFAULT false NOT NULL,
	"status" "case_status" DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"designer_id" integer,
	"price_egp" integer NOT NULL,
	"designer_pay_egp" integer DEFAULT 0 NOT NULL,
	"qc_checks" jsonb,
	"qc_note" text,
	"qc_fails" integer DEFAULT 0 NOT NULL,
	"qc_passed_at" timestamp with time zone,
	"qc_by" integer,
	"delivered_at" timestamp with time zone,
	"invoice_id" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "client_kind" DEFAULT 'clinic' NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"discount_pct" integer DEFAULT 0 NOT NULL,
	"payment_terms_days" integer DEFAULT 14 NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "case_id" integer;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "invoice_id" integer;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "case_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_production_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."production_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_cases" ADD CONSTRAINT "production_cases_client_id_production_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."production_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_cases" ADD CONSTRAINT "production_cases_case_type_id_case_types_id_fk" FOREIGN KEY ("case_type_id") REFERENCES "public"."case_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_cases" ADD CONSTRAINT "production_cases_designer_id_users_id_fk" FOREIGN KEY ("designer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_cases" ADD CONSTRAINT "production_cases_qc_by_users_id_fk" FOREIGN KEY ("qc_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_cases" ADD CONSTRAINT "production_cases_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_cases" ADD CONSTRAINT "production_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_client_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "production_cases_status_idx" ON "production_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "production_cases_designer_idx" ON "production_cases" USING btree ("designer_id");--> statement-breakpoint
CREATE INDEX "production_cases_client_idx" ON "production_cases" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_case_id_production_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."production_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_case_id_production_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."production_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_case_idx" ON "attachments" USING btree ("case_id");