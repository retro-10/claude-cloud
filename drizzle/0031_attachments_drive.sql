ALTER TABLE "attachments" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "drive_file_id" text;