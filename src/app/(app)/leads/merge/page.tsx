import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activities, followUps, leads, sources, stages, users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { Avatar, Card, EmptyState, Icon, PageHeader, pretty } from "@/components/ui";
import { MERGE_FIELDS, MERGE_LABELS, duplicateCandidates, UNDO_DAYS, type MergeField } from "@/lib/merge";
import { requirePageCan } from "@/lib/server-auth";
import { searchLeads } from "@/lib/search";
import { formatCairo } from "@/lib/time";
import { mergeAction } from "../actions";

export const metadata = { title: "Merge leads" };

type Lead = typeof leads.$inferSelect;

export default async function MergePage(props: { searchParams: Promise<{ a?: string; b?: string; q?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("lead:write");
  const a = Number(sp.a);
  if (!Number.isInteger(a) || a <= 0) notFound();
  const b = Number(sp.b);
  const ids = Number.isInteger(b) && b > 0 && b !== a ? [a, b] : [a];
  const rows = await db.select().from(leads).where(inArray(leads.id, ids));
  const A = rows.find((r) => r.id === a);
  if (!A || A.deletedAt) notFound();
  const B = rows.find((r) => r.id === b && !r.deletedAt);

  if (!B) {
    const [suggested, found] = await Promise.all([duplicateCandidates(db, a), sp.q ? searchLeads(db, sp.q, 10) : Promise.resolve([])]);
    const list = [...suggested.map((s) => ({ ...s, why: "looks like a duplicate" })), ...found.filter((f) => f.id !== a && !suggested.some((s) => s.id === f.id)).map((f) => ({ ...f, email: null, city: null, why: "search result" }))];
    return (
      <>
        <PageHeader eyebrow="Data hygiene" title="Merge duplicates" subtitle={<>Choose the other record for <span dir="auto" className="text-fg">{A.fullName}</span>.</>} />
        <form className="mb-4 flex max-w-lg gap-2" method="get">
          <input type="hidden" name="a" value={a} />
          <input id="search" name="q" defaultValue={sp.q} placeholder="Search by name, phone or email" dir="auto" aria-label="Search" className="input" />
          <button className="btn btn-primary">Search</button>
        </form>
        <Card title="Candidates" icon="merge" bodyClass="p-0">
          {list.length === 0 ? (
            <EmptyState icon="search" title="No likely duplicates found">Search for the other record above.</EmptyState>
          ) : (
            <ul className="divide-y divide-line/70">
              {list.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Avatar name={c.fullName} size={30} />
                  <div className="min-w-0 flex-1">
                    <div dir="auto" className="font-medium">{c.fullName}</div>
                    <div className="num text-xs text-muted" dir="ltr">{[c.phone, c.email].filter(Boolean).join(" · ")}</div>
                  </div>
                  <span className="chip">{c.why}</span>
                  <Link href={`/leads/merge?a=${a}&b=${c.id}`} className="btn btn-secondary btn-sm">Compare</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>
    );
  }

  const [srcs, owners, stageList, counts] = await Promise.all([
    db.select().from(sources),
    db.select({ id: users.id, name: users.name }).from(users),
    db.select().from(stages),
    Promise.all(
      [A, B].map(async (l) => ({
        acts: (await db.select({ id: activities.id }).from(activities).where(eq(activities.leadId, l.id))).length,
        fus: (await db.select({ id: followUps.id }).from(followUps).where(eq(followUps.leadId, l.id))).length,
      })),
    ),
  ]);
  const show = (l: Lead, f: MergeField): string => {
    const v = l[f];
    if (v === null || v === undefined || v === "") return "—";
    if (f === "sourceId") return srcs.find((s) => s.id === v)?.label ?? String(v);
    if (f === "ownerId") return owners.find((o) => o.id === v)?.name ?? String(v);
    if (f === "decisionDueAt") return formatCairo(v as Date, false);
    if (f === "offerAmountEgp") return `${v} EGP`;
    return pretty(String(v));
  };
  // the lead further along the pipeline survives by default (it keeps its stage and id)
  const pos = (l: Lead) => stageList.find((s) => s.key === l.stage)?.position ?? 0;
  const [S, L] = pos(B) > pos(A) ? [B, A] : [A, B];
  const differing = MERGE_FIELDS.filter((f) => show(S, f) !== show(L, f));

  return (
    <>
      <PageHeader eyebrow="Data hygiene" title="Merge two leads" subtitle="Pick the value to keep for each field. Every activity, follow-up, consult and payment is kept." />
      <Flash error={sp.error} />
      <form action={mergeAction} className="flex flex-col gap-4">
        <input type="hidden" name="survivorId" value={S.id} />
        <input type="hidden" name="loserId" value={L.id} />
        <div className="card overflow-x-auto">
          <table className="table min-w-[640px]">
            <thead>
              <tr>
                <th>Field</th>
                <th>
                  Keeps its record: <span dir="auto" className="normal-case text-fg">{S.fullName}</span> (#{S.id}, {stageList.find((s) => s.key === S.stage)?.label})
                </th>
                <th>
                  Merged into it: <span dir="auto" className="normal-case text-fg">{L.fullName}</span> (#{L.id}, {stageList.find((s) => s.key === L.stage)?.label})
                </th>
              </tr>
            </thead>
            <tbody>
              {MERGE_FIELDS.map((f) => {
                const same = !differing.includes(f);
                return (
                  <tr key={f} className={same ? "opacity-60" : ""}>
                    <td className="font-medium">{MERGE_LABELS[f]}</td>
                    {(["survivor", "loser"] as const).map((side) => {
                      const l = side === "survivor" ? S : L;
                      return (
                        <td key={side}>
                          <label className="flex items-center gap-2">
                            <input type="radio" name={`pick_${f}`} value={side} defaultChecked={side === "survivor" ? show(S, f) !== "—" || show(L, f) === "—" : show(S, f) === "—" && show(L, f) !== "—"} disabled={same} className="check" />
                            <span dir="auto" className={show(l, f) === "—" ? "text-muted" : ""}>{show(l, f)}</span>
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr>
                <td className="font-medium">History</td>
                {[counts[S.id === A.id ? 0 : 1], counts[S.id === A.id ? 1 : 0]].map((c, i) => (
                  <td key={i} className="text-muted">{c.acts} activities · {c.fus} follow-ups</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="combineNotes" defaultChecked className="check" /> Keep both sets of notes
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary">
            <Icon name="merge" size={14} /> Merge
          </button>
          <Link href={`/leads/merge?a=${a}`} className="btn btn-ghost">Pick another</Link>
          <span className="text-xs text-muted">Timelines are combined; tags are joined. You can undo this for {UNDO_DAYS} days from the lead page.</span>
        </div>
      </form>
    </>
  );
}
