import { asc } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, sources } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { FormEditor } from "@/components/growth/FormEditor";
import { Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { listForms } from "@/lib/lead-forms";
import { publicBaseUrl } from "@/lib/public-url";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Lead forms · Growth" };

// Public sign-up pages. Each submission becomes a lead (or is linked to the person we already have).
export default async function FormsPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const write = can(user.role, "growth:write");
  const [forms, camps, src, base] = await Promise.all([
    listForms(db),
    db.select({ id: campaigns.id, label: campaigns.label }).from(campaigns).orderBy(asc(campaigns.label)),
    db.select().from(sources).orderBy(asc(sources.label)),
    publicBaseUrl(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Lead forms"
        subtitle="Public sign-up pages for masterclasses, ads and the link in bio. Sign-ups arrive as leads with their source, campaign and link tags, and go through the new-lead rules like any other."
        actions={
          <a href="/tools/links" className="btn btn-secondary btn-sm">
            <Icon name="copy" size={14} /> Build a tracked link
          </a>
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-4">
          {forms.length === 0 && (
            <Card>
              <EmptyState icon="send" title="No forms yet.">
                Make one for the next masterclass, or a general &ldquo;apply&rdquo; page for your link in bio.
              </EmptyState>
            </Card>
          )}
          {forms.map((f) => {
            const link = `${base}/f/${f.slug}`;
            return (
              <Card
                key={f.id}
                title={f.title}
                icon="send"
                actions={f.active ? <span className="chip chip-ok">Open</span> : <span className="chip">Closed</span>}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <a href={`/f/${f.slug}`} target="_blank" rel="noreferrer" className="link num break-all" dir="ltr">
                    {link}
                  </a>
                </div>
                <dl className="mb-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="well px-3 py-2">
                    <dt className="text-muted">Sign-ups</dt>
                    <dd className="num text-base font-semibold">{f.total}</dd>
                  </div>
                  <div className="well px-3 py-2">
                    <dt className="text-muted">New leads</dt>
                    <dd className="num text-base font-semibold">{f.newLeads}</dd>
                  </div>
                  <div className="well px-3 py-2">
                    <dt className="text-muted">Last 7 days</dt>
                    <dd className="num text-base font-semibold">{f.week}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted">
                  {f.campaign ? `Campaign: ${f.campaign}` : "No campaign (a link's utm_campaign can set one)"} · Source: {f.source ?? "campaign's, else Website form"}
                </p>
                {write && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted hover:text-fg">Edit</summary>
                    <div className="mt-3">
                      <FormEditor f={f} campaigns={camps} sources={src} />
                    </div>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
        {write && (
          <Card title="New form" icon="plus">
            <FormEditor campaigns={camps} sources={src} />
          </Card>
        )}
      </div>
    </>
  );
}
