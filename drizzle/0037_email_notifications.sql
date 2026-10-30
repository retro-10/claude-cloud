ALTER TABLE "notifications" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_notifications" text DEFAULT 'important' NOT NULL;--> statement-breakpoint
-- everything already in people's inboxes stays out of email: only notifications from now on are sent
UPDATE "notifications" SET "emailed_at" = now() WHERE "emailed_at" IS NULL;
