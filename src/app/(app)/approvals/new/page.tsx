import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { campaigns } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { Card, Icon, PageHeader, Tabs } from "@/components/ui";
import { getSetting } from "@/lib/app-settings";
import { APPROVAL_TYPES, previewApprovers } from "@/lib/approvals";
import { requirePageCan } from "@/lib/server-auth";
import { cairoYmd } from "@/lib/time";
import { submitApprovalAction } from "../actions";

export const metadata = { title: "New request · Approvals" };

export default async function NewRequest(props: { searchParams: Promise<{ type?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("approval:submit");
  const t = APPROVAL_TYPES.find((x) => x.key === sp.type) ?? APPROVAL_TYPES[0];
  const [approvers, rules, camps] = await Promise.all([
    previewApprovers(db, t.key, null, user.id),
    getSetting(db, "approvalRules"),
    t.money ? db.select({ id: campaigns.id, label: campaigns.label }).from(campaigns).orderBy(asc(campaigns.label)) : Promise.resolve([]),
  ]);
  // a rule for this type that starts at an amount means bigger requests may go to other people
  const byAmount = rules.filter((r) => (r.type === t.key || r.type === "*") && r.minAmountEgp !== null);
  const today = cairoYmd(new Date());

  return (
    <>
      <PageHeader eyebrow="Approvals" title="New request" subtitle="Say what you need. The people who approve it are notified and see it in their queue." />
      <Flash error={sp.error} />
      <Tabs label="Kind of request" current={`/approvals/new?type=${t.key}`} items={APPROVAL_TYPES.map((x) => ({ href: `/approvals/new?type=${x.key}`, label: x.label }))} />
      <Card className="max-w-2xl" title={t.label} icon="send">
        <p className="mb-4 text-sm text-muted">{t.hint}.</p>
        <form action={submitApprovalAction} className="flex flex-col gap-4">
          <input type="hidden" name="type" value={t.key} />
          <label className="field">
            What is it?
            <input name="title" required maxLength={200} className="input" placeholder={t.key === "leave" ? "e.g. Annual leave" : t.key === "expense" ? "e.g. Printing for the masterclass" : ""} />
          </label>
          {t.money && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                Amount (EGP)
                <input name="amountEgp" type="number" min={1} step={1} required className="input num" />
              </label>
              <label className="field">
                Category (optional)
                <input name="category" maxLength={60} className="input" placeholder="e.g. Marketing, Equipment" />
              </label>
              {camps.length > 0 && (
                <label className="field sm:col-span-2">
                  For a campaign (optional)
                  <select name="campaignId" defaultValue="" className="input">
                    <option value="">None</option>
                    {camps.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {t.key === "leave" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                First day
                <input name="startsOn" type="date" required min={today} className="input" />
              </label>
              <label className="field">
                Last day
                <input name="endsOn" type="date" min={today} className="input" />
              </label>
            </div>
          )}
          <label className="field">
            Details (optional)
            <textarea name="details" rows={4} maxLength={4000} className="input min-h-24 py-2" placeholder={t.key === "brand" ? "What it is for, sizes, deadline, examples" : "Anything the approver should know"} />
          </label>
          <div className="rounded-lg bg-raised px-3 py-2 text-sm">
            <span className="text-muted">Goes to: </span>
            {approvers.length ? approvers.map((a) => a.name).join(", ") : "nobody yet (add another owner in Settings > Users)"}
            {byAmount.length > 0 && <span className="text-muted"> (larger amounts may go to others, by the routing rules)</span>}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary">
              <Icon name="send" size={15} /> Send for approval
            </button>
            <Link href="/approvals" className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
