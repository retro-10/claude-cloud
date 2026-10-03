CREATE TABLE "budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"section" "ledger_section" NOT NULL,
	"category" text NOT NULL,
	"amount_egp" integer NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_month_category_uq" ON "budgets" USING btree ("month","section","category");