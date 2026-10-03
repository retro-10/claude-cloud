CREATE TABLE "weekly_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start" text NOT NULL,
	"wins" text,
	"misses" text,
	"decisions" text,
	"notes" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reviews_week_start_unique" UNIQUE("week_start")
);
--> statement-breakpoint
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;