CREATE TYPE "public"."worker_type" AS ENUM('employee', 'partner', 'contractor');--> statement-breakpoint
CREATE TABLE "employee_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"replaces_id" integer,
	"status" text DEFAULT 'current' NOT NULL,
	"needs_ack" boolean DEFAULT true NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"worker_type" "worker_type" DEFAULT 'employee' NOT NULL,
	"job_title" text,
	"start_date" text,
	"end_date" text,
	"manager_id" integer,
	"phone" text,
	"personal_email" text,
	"address" text,
	"emergency_name" text,
	"emergency_phone" text,
	"pay_terms" text,
	"pay_amount_egp" integer,
	"pay_schedule" text,
	"notice_period" text,
	"team_member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "employee_document_id" integer;--> statement-breakpoint
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_replaces_id_employee_documents_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."employee_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_change_requests_status_idx" ON "employee_change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employee_documents_user_idx" ON "employee_documents" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_employee_document_id_employee_documents_id_fk" FOREIGN KEY ("employee_document_id") REFERENCES "public"."employee_documents"("id") ON DELETE no action ON UPDATE no action;