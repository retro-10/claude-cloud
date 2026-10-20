CREATE TYPE "public"."attendance_status" AS ENUM('present', 'late', 'absent', 'excused');--> statement-breakpoint
CREATE TABLE "batch_classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"cohort_id" integer NOT NULL,
	"title" text NOT NULL,
	"module" text,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer DEFAULT 120 NOT NULL,
	"instructor_id" integer,
	"location" text,
	"recording_url" text,
	"materials_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "class_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"enrolment_id" integer NOT NULL,
	"status" "attendance_status" NOT NULL,
	"marked_by" integer,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batch_classes" ADD CONSTRAINT "batch_classes_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_classes" ADD CONSTRAINT "batch_classes_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_attendance" ADD CONSTRAINT "class_attendance_class_id_batch_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."batch_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_attendance" ADD CONSTRAINT "class_attendance_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_attendance" ADD CONSTRAINT "class_attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_classes_cohort_idx" ON "batch_classes" USING btree ("cohort_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "class_attendance_uq" ON "class_attendance" USING btree ("class_id","enrolment_id");--> statement-breakpoint
CREATE INDEX "class_attendance_enrolment_idx" ON "class_attendance" USING btree ("enrolment_id");