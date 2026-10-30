CREATE TABLE "time_aux" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "time_aux" ADD CONSTRAINT "time_aux_entry_id_time_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_aux" ADD CONSTRAINT "time_aux_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_aux_entry_idx" ON "time_aux" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "time_aux_user_idx" ON "time_aux" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "time_aux_one_open_uq" ON "time_aux" USING btree ("user_id") WHERE "time_aux"."ended_at" is null;