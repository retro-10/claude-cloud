import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
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
// Candidates pay OrlaDent directly (no payment gateway); a candidate may pay once or in instalments.
export const paymentPlanEnum = pgEnum("payment_plan", ["one_time", "installments", "free_seat"]);
export const studentStatusEnum = pgEnum("student_status", ["active", "graduated", "dropped"]);
export const cohortStatusEnum = pgEnum("cohort_status", ["planning", "live", "closed"]);
// Finance ledger, mirroring the Notion Ledger: money only counts once it is Received (income) or Paid (costs).
export const ledgerSectionEnum = pgEnum("ledger_section", ["income", "fixed_costs", "variable_costs", "partner_withdrawals"]);
export const ledgerStatusEnum = pgEnum("ledger_status", ["received", "expected", "paid", "owed", "cancelled"]);
// "no_decision" = went silent after the offer, kept apart from an explicit "no" (reported separately)
export const lostReasonKindEnum = pgEnum("lost_reason_kind", ["explicit", "no_decision"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("sales"),
  active: boolean("active").notNull().default(true),
  // NULL = still on the password it was created/seeded with; the app nags until the user sets their own
  passwordChangedAt: ts("password_changed_at"),
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
  kind: lostReasonKindEnum("kind").notNull().default("explicit"),
});

export const cohorts = pgTable("cohorts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  masterclassAt: ts("masterclass_at"),
  enrolmentCloseAt: ts("enrolment_close_at"),
  seatCap: integer("seat_cap").notNull(),
  startAt: ts("start_at"),
  openAt: ts("open_at"), // enrolment opens
  status: cohortStatusEnum("status").notNull().default("planning"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    fullName: text("full_name").notNull(),
    // E.164, e.g. +201001234567. Unique among non-null values (Postgres allows many NULLs).
    phoneWhatsapp: text("phone_whatsapp").unique(),
    phoneRaw: text("phone_raw"), // exactly what was typed or imported, for traceability
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
    // offer details (exit criteria for Offer sent): what was offered and when they will decide
    offerTier: tierEnum("offer_tier"),
    offerAmountEgp: integer("offer_amount_egp"),
    offerPaymentLink: text("offer_payment_link"),
    offerSentAt: ts("offer_sent_at"), // payment link sent
    decisionDueAt: ts("decision_due_at"), // the decision date the lead agreed to
    doNotContact: boolean("do_not_contact").notNull().default(false),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    lostReviewedAt: ts("lost_reviewed_at"), // no-decision review: closed without reactivating
    mergedIntoId: integer("merged_into_id"), // set on the lead that disappeared in a merge
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
    index("leads_tags_idx").using("gin", t.tags),
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
    templateId: integer("template_id").references(() => messageTemplates.id), // message sent from a template
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
    ruleId: integer("rule_id").references(() => workflowRules.id), // created by a workflow rule
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
    confirmedAt: ts("confirmed_at"), // the lead confirmed the date and time
    recommendedTier: tierEnum("recommended_tier"),
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
    amountEgp: integer("amount_egp").notNull(), // tier price agreed (before discount)
    discountEgp: integer("discount_egp").notNull().default(0),
    paymentPlan: paymentPlanEnum("payment_plan").notNull().default("one_time"),
    firstInstalmentAt: ts("first_instalment_at"),
    finalInstalmentAt: ts("final_instalment_at"),
    status: studentStatusEnum("status").notNull().default("active"),
    notes: text("notes"),
    // programme data kept in the Notion Candidates database
    contentConsent: boolean("content_consent").notNull().default(false), // "Consent on file?": may we use their work / words in content
    contentConsentScope: text("content_consent_scope").array().notNull().default(sql`'{}'::text[]`), // Voice, Video, Patient case, Name
    qcScore: real("qc_score"),
    leaderboardRank: integer("leaderboard_rank"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
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

// Small key/value store for thresholds and switches edited in Settings (see src/lib/app-settings.ts).
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id),
});

// What must be true before a lead may ENTER a stage. check_key names a check in src/lib/exit-criteria.ts.
export const stageExitCriteria = pgTable(
  "stage_exit_criteria",
  {
    id: serial("id").primaryKey(),
    stageKey: text("stage_key")
      .notNull()
      .references(() => stages.key),
    checkKey: text("check_key").notNull(),
    required: boolean("required").notNull().default(true),
  },
  (t) => [uniqueIndex("stage_exit_criteria_uq").on(t.stageKey, t.checkKey)],
);

export const messageTemplates = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  language: text("language").notNull().default("ar"), // "ar" | "en"
  body: text("body").notNull(),
  usageCount: integer("usage_count").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// Rules create tasks, tags and notifications. They never send a message.
export const workflowRules = pgTable("workflow_rules", {
  id: serial("id").primaryKey(),
  key: text("key").unique(), // set for the built-in rules
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  conditions: jsonb("conditions").notNull().$type<Record<string, string>>().default({}),
  actions: jsonb("actions").notNull().$type<RuleAction[]>(),
  enabled: boolean("enabled").notNull().default(true),
  builtin: boolean("builtin").notNull().default(false),
  position: integer("position").notNull().default(100),
  createdAt: createdAt(),
});

export type RuleAction =
  | { type: "create_follow_up"; kind: string; note: string; dueInMinutes?: number; dueAt?: "decision_date" }
  | { type: "apply_cadence"; cadence: string }
  | { type: "cancel_follow_ups" }
  | { type: "cancel_cadence" }
  | { type: "add_tag"; tag: string; ifLostReasons?: string[] }
  | { type: "set_owner"; userId: number }
  | { type: "notify"; title: string };

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: serial("id").primaryKey(),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => workflowRules.id),
    leadId: integer("lead_id").references(() => leads.id),
    firedAt: ts("fired_at").notNull().defaultNow(),
    result: text("result").notNull(), // short human summary of what the rule did
    dedupeKey: text("dedupe_key").unique(), // scheduled triggers fire once per thing (e.g. per follow-up)
  },
  (t) => [index("workflow_runs_fired_at_idx").on(t.firedAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    leadId: integer("lead_id").references(() => leads.id),
    createdAt: createdAt(),
    readAt: ts("read_at"),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)],
);

// Contact consent history: the latest row per lead and channel is the current answer.
export const consentRecords = pgTable(
  "consent_records",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    channel: text("channel").notNull().default("whatsapp"),
    granted: boolean("granted").notNull(),
    method: text("method").notNull(), // how we know: they messaged first, form tick, told us in chat, …
    at: ts("at").notNull().defaultNow(),
    byUserId: integer("by_user_id").references(() => users.id),
  },
  (t) => [index("consent_records_lead_idx").on(t.leadId, t.at)],
);

// A merge can be undone for 7 days: the snapshot and the moved row ids are enough to put things back.
export const leadMerges = pgTable("lead_merges", {
  id: serial("id").primaryKey(),
  survivorId: integer("survivor_id")
    .notNull()
    .references(() => leads.id),
  loserId: integer("loser_id")
    .notNull()
    .references(() => leads.id),
  survivorBefore: jsonb("survivor_before").notNull(),
  loserBefore: jsonb("loser_before").notNull(),
  moved: jsonb("moved").notNull().$type<Record<string, number[]>>(),
  byUserId: integer("by_user_id").references(() => users.id),
  mergedAt: ts("merged_at").notNull().defaultNow(),
  undoneAt: ts("undone_at"),
});

// Every money movement: candidate payments (linked to an enrolment), client work, costs, refunds, partner
// withdrawals. Payments are ledger rows, so a candidate can pay in several instalments.
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: serial("id").primaryKey(),
    entry: text("entry").notNull(), // short title, e.g. "Kero — final installment"
    amountEgp: integer("amount_egp").notNull(), // always positive; the section says which way it goes
    date: ts("date"), // when the money moved (or is due); NULL = the day it was recorded
    dateApproximate: boolean("date_approximate").notNull().default(false),
    section: ledgerSectionEnum("section").notNull(),
    category: text("category").notNull(),
    status: ledgerStatusEnum("status").notNull(),
    partner: text("partner"), // for partner withdrawals
    fromTo: text("from_to"),
    reference: text("reference"), // transfer / receipt reference
    notes: text("notes"),
    enrolmentId: integer("enrolment_id").references(() => enrolments.id),
    cohortId: integer("cohort_id").references(() => cohorts.id),
    teamMemberId: integer("team_member_id").references(() => teamMembers.id), // who a salary / freelance cost was paid to
    createdBy: integer("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("ledger_date_idx").on(t.date), index("ledger_enrolment_idx").on(t.enrolmentId)],
);

// Mirror of the Notion Team database (read-only here): who a cost was paid to. Pay and equity stay in Notion.
export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role"),
  group: text("group"), // Board | Staff
  status: text("status"), // Active | Inactive
  contact: text("contact"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// Programme sessions (Notion "Sessions"): 1:1s and group Q&As, each for one candidate.
export const programmeSessions = pgTable(
  "programme_sessions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    enrolmentId: integer("enrolment_id").references(() => enrolments.id),
    type: text("type"), // Production Partner 1:1 | Freelance Ready group Q&A
    dayOfWeek: text("day_of_week"),
    time: text("time"),
    recorded: boolean("recorded").notNull().default(false),
    driveLink: text("drive_link"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("programme_sessions_enrolment_idx").on(t.enrolmentId)],
);

// Proof & Testimonial Bank: quotes, QC results, screenshots a candidate gave, and whether we may use them.
export const proofItems = pgTable(
  "proof_items",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    enrolmentId: integer("enrolment_id").references(() => enrolments.id),
    type: text("type"), // Voice note | Screenshot | QC result | Leaderboard shot | Video | Message
    consentStatus: text("consent_status"), // Not asked | Asked | Granted | Declined
    usableIn: text("usable_in").array().notNull().default(sql`'{}'::text[]`), // Reel, Carousel, Story, YouTube, Text
    fileOrLink: text("file_or_link"),
    quote: text("quote"), // the real quote or transcript, word for word
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("proof_items_enrolment_idx").on(t.enrolmentId)],
);

// Two-way Notion sync: which Notion page each local row is, and what both sides looked like at the last sync.
export const notionLinks = pgTable(
  "notion_links",
  {
    id: serial("id").primaryKey(),
    entity: text("entity").notNull(), // lead | cohort | enrolment | ledger | team | session | proof
    localId: integer("local_id").notNull(),
    pageId: text("page_id").notNull().unique(),
    notionEditedAt: ts("notion_edited_at"), // last_edited_time of the page after our last read or write
    syncedAt: ts("synced_at").notNull().defaultNow(), // local updated_at we last pushed or pulled
    hash: text("hash"), // hash of the synced field values, to skip no-op writes
  },
  (t) => [uniqueIndex("notion_links_entity_local_uq").on(t.entity, t.localId)],
);

export const notionSyncRuns = pgTable("notion_sync_runs", {
  id: serial("id").primaryKey(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  pushed: integer("pushed").notNull().default(0),
  pulled: integer("pulled").notNull().default(0),
  created: integer("created").notNull().default(0),
  conflicts: integer("conflicts").notNull().default(0),
  errors: jsonb("errors").$type<string[]>().notNull().default([]),
});
