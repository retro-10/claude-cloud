import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, messageTemplates } from "@/db/schema";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";
import { templateContext } from "@/lib/templates";

export const dynamic = "force-dynamic";

// Everything the message composer needs for one lead: its templates and the placeholder values.
// Read-only; logging a sent message is a separate server action that needs lead:write.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  if (!can(user.role, "lead:read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await props.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [lead] = await db
    .select({ id: leads.id, fullName: leads.fullName, phone: leads.phoneWhatsapp, doNotContact: leads.doNotContact, deletedAt: leads.deletedAt })
    .from(leads)
    .where(eq(leads.id, id));
  if (!lead || lead.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [templates, ar, en] = await Promise.all([
    db.select().from(messageTemplates).where(and(eq(messageTemplates.active, true))).orderBy(asc(messageTemplates.category), asc(messageTemplates.id)),
    templateContext(db, id, "ar"),
    templateContext(db, id, "en"),
  ]);
  return NextResponse.json(
    {
      lead: { id: lead.id, fullName: lead.fullName, phone: lead.phone, doNotContact: lead.doNotContact },
      templates: templates.map((t) => ({ id: t.id, name: t.name, category: t.category, language: t.language, body: t.body })),
      ctx: { ar, en },
      canWrite: can(user.role, "lead:write"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
