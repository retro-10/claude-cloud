import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { leads, stages } from "@/db/schema";

// Arabic spelling variants people type interchangeably: alef forms, alef maqsura / yeh, teh marbuta / heh.
// Folded the same way in SQL (translate) and in JS so "احمد" finds "أحمد" and "فاطمه" finds "فاطمة".
const AR_FROM = "أإآٱىة";
const AR_TO = "اااايه";

export function foldArabic(s: string): string {
  let out = "";
  for (const ch of s.replace(/ـ/g, "")) {
    const i = AR_FROM.indexOf(ch);
    out += i >= 0 ? AR_TO[i] : ch;
  }
  return out.toLowerCase();
}

export const foldedSql = (col: SQL | typeof leads.fullName) => sql`translate(lower(replace(${col}, 'ـ', '')), ${AR_FROM}, ${AR_TO})`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/**
 * Digits to look for inside a stored E.164 number. Spaces, dashes and brackets are ignored, and the
 * local trunk prefix is dropped: "0100 777-66" and "+20 100 777 66" both search for "10077766".
 * Returns null when there are too few digits to be a phone search.
 */
export function phoneDigits(q: string): string | null {
  const western = q.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));
  let digits = western.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("200")) digits = "20" + digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length >= 3 ? digits : null;
}

/** The text-match condition shared by the lead list and the command palette. */
export function leadTextMatch(q: string): SQL | undefined {
  const t = q.trim();
  if (!t) return undefined;
  const like = `%${escapeLike(foldArabic(t))}%`;
  const digits = phoneDigits(t);
  const parts = [
    sql`${foldedSql(leads.fullName)} like ${like}`,
    sql`lower(coalesce(${leads.email}, '')) like ${like}`,
    sql`${foldedSql(sql`coalesce(${leads.notes}, '')`)} like ${like}`,
    sql`${foldedSql(sql`coalesce(${leads.city}, '')`)} like ${like}`,
  ];
  if (digits) parts.push(sql`coalesce(${leads.phoneWhatsapp}, '') like ${"%" + digits + "%"}`);
  return sql`(${sql.join(parts, sql` or `)})`;
}

export type SearchHit = { id: number; fullName: string; phone: string | null; stage: string; stageLabel: string; stageKind: string };

export async function searchLeads(db: Db, q: string, limit = 8): Promise<SearchHit[]> {
  const match = leadTextMatch(q);
  if (!match) return [];
  const prefix = escapeLike(foldArabic(q.trim())) + "%";
  return db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      phone: leads.phoneWhatsapp,
      stage: leads.stage,
      stageLabel: stages.label,
      stageKind: stages.kind,
    })
    .from(leads)
    .innerJoin(stages, eq(stages.key, leads.stage))
    .where(and(isNull(leads.deletedAt), match))
    .orderBy(sql`(${foldedSql(leads.fullName)} like ${prefix}) desc`, desc(leads.updatedAt))
    .limit(limit);
}
