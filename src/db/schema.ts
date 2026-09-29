import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// All timestamps are timestamptz (stored as UTC). Display converts to Africa/Cairo.
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const roleEnum = pgEnum("role", ["owner", "sales", "viewer", "finance"]);
export const segmentEnum = pgEnum("segment", ["fresh_graduate", "technician", "dentist", "other"]);
export const tierEnum = pgEnum("tier", ["foundation", "freelance_ready", "production_partner"]);
export const tierInterestEnum = pgEnum("tier_interest", [
  "foundation",
  "freelance_ready",
  "production_partner",
  "unsure",
]);
export const stageKindEnum = pgEnum("stage_kind", ["open", "won", "lost", "nurture"]);
export const activityTypeEnum = pgEnum("activity_type", [
  "whatsapp",
  "call",
  "instagram",
  "linkedin",
  "email",
  "note",
  "consult",
]);
export const directionEnum = pgEnum("direction", ["out", "in", "internal"]);
export const consultOutcomeEnum = pgEnum("consult_outcome", [
  "enrolled",
  "thinking",
  "not_fit",
  "no_show",
]);
export const gatewayEnum = pgEnum("gateway", ["paymob", "other"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("sales"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const stages = pgTable("stages", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // stable identifier, never edited
  label: text("label").notNull(),
  position: integer("position").notNull(),
  kind: stageKindEnum("kind").notNull().default("open"),
});

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().unique(),
});

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  sourceId: integer("source_id").references(() => sources.id),
  startedAt: ts("started_at"),
});

export const objections = pgTable("objections", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().unique(),
});

export const lostReasons = pgTable("lost_reasons", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().unique(),
});

export const cohorts = pgTable("cohorts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  masterclassAt: ts("masterclass_at"),
  enrolmentCloseAt: ts("enrolment_close_at"),
  seatCap: integer("seat_cap").notNull(),
  startAt: ts("start_at"),
});

export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    fullName: text("full_name").notNull(),
    // E.164, e.g. +201001234567. Unique among non-null values (Postgres allows many NULLs).
    phoneWhatsapp: text("phone_whatsapp").unique(),
    email: text("email"),
    city: text("city"),
    segment: segmentEnum("segment"),
    sourceId: integer("source_id").references(() => sources.id),
    campaignId: integer("campaign_id").references(() => campaigns.id),
    tierInterest: tierInterestEnum("tier_interest").notNull().default("unsure"),
    stage: text("stage")
      .notNull()
      .default("new")
      .references(() => stages.key),
    ownerId: integer("owner_id").references(() => users.id),
    notes: text("notes"),
    lostReasonId: integer("lost_reason_id").references(() => lostReasons.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    firstContactAt: ts("first_contact_at"),
    firstReplyAt: ts("first_reply_at"),
    closedAt: ts("closed_at"),
    deletedAt: ts("deleted_at"), // soft delete; NULL = live
  },
  (t) => [
    index("leads_stage_idx").on(t.stage),
    index("leads_owner_idx").on(t.ownerId),
    index("leads_created_at_idx").on(t.createdAt),
    index("leads_source_idx").on(t.sourceId),
    // case-insensitive email lookup for duplicate checks; unique among live, non-null emails
    uniqueIndex("leads_email_lower_uq")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null and ${t.deletedAt} is null`),
    index("leads_deleted_at_idx").on(t.deletedAt),
  ],
);

// One row per stage change (and one for creation: from_stage NULL). Conversion metrics read this table.
export const stageEvents = pgTable(
  "stage_events",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    fromStage: text("from_stage").references(() => stages.key),
    toStage: text("to_stage")
      .notNull()
      .references(() => stages.key),
    at: ts("at").notNull().defaultNow(),
    byUserId: integer("by_user_id").references(() => users.id),
  },
  (t) => [
    index("stage_events_lead_idx").on(t.leadId),
    index("stage_events_to_stage_at_idx").on(t.toStage, t.at),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    type: activityTypeEnum("type").notNull(),
    direction: directionEnum("direction").notNull().default("internal"),
    body: text("body"),
    at: ts("at").notNull().defaultNow(),
    byUserId: integer("by_user_id").references(() => users.id),
    // room for imported messages later (e.g. a WhatsApp export); null for hand-logged rows
    externalId: text("external_id"),
  },
  (t) => [index("activities_lead_at_idx").on(t.leadId, t.at)],
);

export const cadenceTemplates = pgTable("cadence_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  // [{ offset_days: number, kind: string, message_hint: string }]
  steps: jsonb("steps").notNull().$type<CadenceStep[]>(),
});

export type CadenceStep = { offset_days: number; kind: string; message_hint: string };

export const followUps = pgTable(
  "follow_ups",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    dueAt: ts("due_at").notNull(),
    kind: text("kind").notNull().default("whatsapp"),
    note: text("note"),
    doneAt: ts("done_at"),
    cancelledAt: ts("cancelled_at"), // set by the cadence stop rule
    createdBy: integer("created_by").references(() => users.id),
    templateId: integer("template_id").references(() => cadenceTemplates.id), // NULL = manual
    createdAt: createdAt(),
  },
  (t) => [
    index("follow_ups_due_at_idx").on(t.dueAt),
    index("follow_ups_lead_idx").on(t.leadId),
  ],
);

export const consults = pgTable(
  "consults",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    scheduledAt: ts("scheduled_at").notNull(),
    held: boolean("held").notNull().default(false),
    outcome: consultOutcomeEnum("outcome"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("consults_lead_idx").on(t.leadId), index("consults_scheduled_idx").on(t.scheduledAt)],
);

// objection_tags on consults, normalised so they can be aggregated
export const consultObjections = pgTable(
  "consult_objections",
  {
    consultId: integer("consult_id")
      .notNull()
      .references(() => consults.id, { onDelete: "cascade" }),
    objectionId: integer("objection_id")
      .notNull()
      .references(() => objections.id),
  },
  (t) => [primaryKey({ columns: [t.consultId, t.objectionId] })],
);

export const enrolments = pgTable(
  "enrolments",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    cohortId: integer("cohort_id")
      .notNull()
      .references(() => cohorts.id),
    tier: tierEnum("tier").notNull(),
    amountEgp: integer("amount_egp").notNull(),
    paidAt: ts("paid_at"),
    paymentRef: text("payment_ref"),
    gateway: gatewayEnum("gateway").notNull().default("other"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("enrolments_lead_cohort_uq").on(t.leadId, t.cohortId),
    index("enrolments_cohort_idx").on(t.cohortId),
  ],
);

export const savedViews = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  filters: jsonb("filters").notNull().$type<Record<string, string>>(),
  shared: boolean("shared").notNull().default(false),
  createdAt: createdAt(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    diff: jsonb("diff"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_entity_idx").on(t.entity, t.entityId)],
);
