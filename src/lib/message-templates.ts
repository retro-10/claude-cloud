import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { messageTemplates } from "@/db/schema";
import { audit } from "./audit";
import { CATEGORIES, unknownPlaceholders } from "./templates-render";

// E2, honest deadlines: a template may not contain a typed date. Dates come from placeholders that
// read the cohort or lead record ({cohort_close_date}, {decision_date}, …), so they can never drift.
const TYPED_DATE =
  /\b\d{1,2}\s*[/.-]\s*\d{1,2}(\s*[/.-]\s*\d{2,4})?\b|\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)/i;

export function templateProblem(t: { name: string; category: string; language: string; body: string }): string | null {
  if (!t.name.trim() || t.name.length > 80) return "Give the template a name (up to 80 characters)";
  if (!(t.category in CATEGORIES)) return "Choose a category";
  if (t.language !== "ar" && t.language !== "en") return "Choose Arabic or English";
  if (!t.body.trim() || t.body.length > 2000) return "The message must be 1-2000 characters";
  const unknown = unknownPlaceholders(t.body);
  if (unknown.length) return `Unknown placeholder: ${unknown.map((u) => `{${u}}`).join(", ")}`;
  if (TYPED_DATE.test(t.body)) return "Don't type dates into a template: use {cohort_close_date}, {masterclass_date}, {decision_date} or {consult_time} so the date always comes from the record.";
  return null;
}

export async function saveMessageTemplate(
  db: Db,
  id: number | null,
  t: { name: string; category: string; language: string; body: string },
  actorId: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const bad = templateProblem(t);
  if (bad) return { ok: false, error: bad };
  const values = { name: t.name.trim(), category: t.category, language: t.language, body: t.body.trim(), updatedAt: new Date() };
  if (id) await db.update(messageTemplates).set(values).where(eq(messageTemplates.id, id));
  else await db.insert(messageTemplates).values(values);
  await audit(db, { userId: actorId, entity: "message_template", entityId: id ?? undefined, action: id ? "update" : "create" });
  return { ok: true };
}

export async function setTemplateActive(db: Db, id: number, active: boolean, actorId: number | null) {
  await db.update(messageTemplates).set({ active, updatedAt: new Date() }).where(eq(messageTemplates.id, id));
  await audit(db, { userId: actorId, entity: "message_template", entityId: id, action: active ? "restore" : "archive" });
}
