import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, leadForms, leads, proofItems, users } from "@/db/schema";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { ContentForm } from "@/components/growth/ContentForm";
import { Card, Icon, PageHeader } from "@/components/ui";
import { FORMATS, PLATFORMS, STATUSES, getContent } from "@/lib/content";
import { publicBaseUrl } from "@/lib/public-url";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { deleteContentAction } from "../actions";

export const metadata = { title: "Content · Growth" };

const UTM_SOURCE: Record<string, string> = { instagram: "instagram", tiktok: "tiktok", facebook: "facebook", youtube: "youtube", linkedin: "linkedin", whatsapp: "whatsapp", other: "other" };

export default async function ContentItemPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [params, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const c = await getContent(db, id);
  if (!c) notFound();
  const [people, camps, [form], [proof], fromIt, base] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    db.select({ id: campaigns.id, label: campaigns.label, slug: campaigns.slug }).from(campaigns).orderBy(asc(campaigns.label)),
    db.select().from(leadForms).where(and(eq(leadForms.active, true), c.campaignId ? eq(leadForms.campaignId, c.campaignId) : sql`true`)).orderBy(asc(leadForms.id)).limit(1),
    c.proofItemId ? db.select().from(proofItems).where(eq(proofItems.id, c.proofItemId)) : Promise.resolve([]),
    c.tag ? db.select({ id: leads.id, fullName: leads.fullName }).from(leads).where(and(isNull(leads.deletedAt), sql`${leads.attribution}->>'utm_content' = ${c.tag}`)).limit(50) : Promise.resolve([]),
    publicBaseUrl(),
  ]);
  const campaignSlug = camps.find((g) => g.id === c.campaignId)?.slug;
  const link = form && c.tag ? `${base}/f/${form.slug}?utm_source=${UTM_SOURCE[c.platform]}&utm_medium=${c.format}${campaignSlug ? `&utm_campaign=${campaignSlug}` : ""}&utm_content=${c.tag}` : null;
  const write = can(user.role, "growth:write");

  return (
    <>
      <Link href="/growth/content" className="mb-3 flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> Content calendar
      </Link>
      <PageHeader
        eyebrow={`${PLATFORMS[c.platform]} · ${FORMATS[c.format]} · ${STATUSES[c.status]}`}
        title={c.title}
        titleDir="auto"
        subtitle={c.publishAt ? `Publishing ${formatCairo(c.publishAt)}` : "No date yet"}
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Plan" icon="edit">
          {write ? <ContentForm c={c} people={people} campaigns={camps} me={user.id} back={`/growth/content/${c.id}`} /> : <p className="whitespace-pre-line text-sm">{c.brief}</p>}
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="Its link" icon="send">
            {link ? (
              <>
                <p className="mb-2 text-xs text-muted">Put this in the caption, bio or story so leads from this piece are counted here.</p>
                <code className="num block break-all rounded bg-raised px-2 py-1.5 text-xs" dir="ltr">
                  {link}
                </code>
              </>
            ) : (
              <p className="text-sm text-muted">
                Make an open <Link href="/growth/forms" className="link">lead form</Link> to get a tracked link for this piece. Its tag is <code className="num">{c.tag}</code>.
              </p>
            )}
            <p className="mt-3 text-sm">
              <span className="font-medium">{fromIt.length}</span> lead{fromIt.length === 1 ? "" : "s"} came through it
            </p>
            {fromIt.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {fromIt.map((l) => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="link" dir="auto">
                      {l.fullName}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {proof && (
            <Card title="From the proof bank" icon="sparkle">
              <p className="text-sm" dir="auto">
                {proof.name}
              </p>
              <p className="mt-1 text-xs text-muted">Consent: {proof.consentStatus ?? "Not asked"}. Use the quote word for word; no income promises.</p>
            </Card>
          )}
          {write && (
            <form action={deleteContentAction}>
              <input type="hidden" name="id" value={c.id} />
              <ConfirmButton message="Remove this piece from the calendar?" className="btn btn-ghost btn-sm">
                <Icon name="trash" size={14} /> Remove from the calendar
              </ConfirmButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
