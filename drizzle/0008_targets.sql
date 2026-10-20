CREATE TABLE "targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"metric" text NOT NULL,
	"period" text NOT NULL,
	"value" integer NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "targets_metric_period_uq" ON "targets" USING btree ("metric","period");