CREATE TABLE "student_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"password_hash" text,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_accounts_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
ALTER TABLE "student_accounts" ADD CONSTRAINT "student_accounts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_accounts" ADD CONSTRAINT "student_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;