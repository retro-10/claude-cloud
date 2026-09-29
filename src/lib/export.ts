import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { leads, sources, stages, users } from "@/db/schema";
import { toCsv } from "./csv";
import { buildOrder, buildWhere, type LeadFilters } from "./lead-list";

export const EXPORT_HEADERS = [
  "name",
  "phone",
  "email",
  "city",
  "segment",
  "source",
  "tier_interest",
  "stage",
  "owner",
  "created_at",
  "first_contact_at",
  "notes",
];

// Every lead matching the filters (not just the current page).
export async function exportLeadsCsv(db: Db, f: LeadFilters): Promise<{ csv: string; count: number }> {
  const rows = await db
    .select({
      name: leads.fullName,
      phone: leads.phoneWhatsapp,
      email: leads.email,
      city: leads.city,
      segment: leads.segment,
      source: sources.label,
      tier: leads.tierInterest,
      stage: stages.label,
      owner: users.name,
      createdAt: leads.createdAt,
      firstContactAt: leads.firstContactAt,
      notes: leads.notes,
    })
    .from(leads)
    .leftJoin(stages, eq(stages.key, leads.stage))
    .leftJoin(sources, eq(sources.id, leads.sourceId))
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(buildWhere(f))
    .orderBy(...buildOrder(f));
  const data = rows.map((r) => [
    r.name,
    r.phone,
    r.email,
    r.city,
    r.segment,
    r.source,
    r.tier,
    r.stage,
    r.owner,
    r.createdAt.toISOString(),
    r.firstContactAt?.toISOString() ?? "",
    r.notes,
  ]);
  return { csv: toCsv([EXPORT_HEADERS, ...data]), count: rows.length };
}
