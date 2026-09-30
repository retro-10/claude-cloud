import { and, asc, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { cohorts, consults, leads } from "@/db/schema";
import { TZ } from "./time";

import { type Placeholder, type TemplateContext } from "./templates-render";

export * from "./templates-render";


const TIER_LABEL: Record<string, string> = {
  foundation: "Foundation",
  freelance_ready: "Freelance Ready",
  production_partner: "Production Partner",
};

const date = (d: Date, lang: "ar" | "en", withTime = false) =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(d);

/** Values for one lead, in the template's language. */
export async function templateContext(db: Pick<Db, "select">, leadId: number, lang: "ar" | "en" = "en", now = new Date()): Promise<TemplateContext> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) return {};
  const [consult] = await db
    .select()
    .from(consults)
    .where(and(eq(consults.leadId, leadId), eq(consults.held, false), isNull(consults.outcome), gte(consults.scheduledAt, now)))
    .orderBy(asc(consults.scheduledAt))
    .limit(1);
  const [cohort] = await db.select().from(cohorts).where(gte(cohorts.enrolmentCloseAt, now)).orderBy(asc(cohorts.enrolmentCloseAt)).limit(1);

  const ctx: TemplateContext = {};
  const first = lead.fullName.trim().split(/\s+/)[0];
  if (first) ctx.first_name = first;
  const tier = lead.offerTier ?? (lead.tierInterest !== "unsure" ? lead.tierInterest : null);
  if (tier) ctx.tier = TIER_LABEL[tier] ?? tier;
  if (lead.offerPaymentLink) ctx.payment_link = lead.offerPaymentLink;
  if (lead.decisionDueAt) ctx.decision_date = date(lead.decisionDueAt, lang);
  if (consult) ctx.consult_time = date(consult.scheduledAt, lang, true);
  if (cohort) {
    ctx.cohort_name = cohort.name;
    if (cohort.enrolmentCloseAt) ctx.cohort_close_date = date(cohort.enrolmentCloseAt, lang);
    if (cohort.masterclassAt && cohort.masterclassAt >= now) ctx.masterclass_date = date(cohort.masterclassAt, lang, true);
  }
  return ctx;
}

