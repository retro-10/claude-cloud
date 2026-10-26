import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { ContentForm } from "@/components/growth/ContentForm";
import { Card, EmptyState, Icon, PageHeader, Tabs } from "@/components/ui";
import { FORMATS, PLATFORMS, STATUSES, listContent, type ContentRow, type ContentStatus } from "@/lib/content";
import { monthRange, shiftMonth, thisMonth } from "@/lib/finance";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { addDaysYmd, cairoYmd } from "@/lib/time";
import { contentStatusAction } from "./actions";

export const metadata = { title: "Content · Growth" };

const STATUS_CHIP: Record<ContentStatus, string> = { idea: "chip", scripting: "chip", filming: "chip chip-brand", editing: "chip chip-brand", scheduled: "chip chip-warn", posted: "chip chip-ok" };
const ORDER = Object.keys(STATUSES) as ContentStatus[];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Piece({ c, compact }: { c: ContentRow; compact?: boolean }) {
  return (
    <Link href={`/growth/content/${c.id}`} className={`block rounded-lg border border-line bg-surface px-2 py-1.5 text-xs hover:border-brand/50 ${compact ? "" : "py-2"}`}>
      <span className="block truncate font-medium" dir="auto">
        {c.title}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
        {PLATFORMS[c.platform]} · {FORMATS[c.format]}
        <span className={STATUS_CHIP[c.status]}>{STATUSES[c.status]}</span>
        {c.leads > 0 && <span className="chip chip-ok">{c.leads} leads</span>}
      </span>
    </Link>
  );
}

// The content calendar: plan by month, run production on the board, and see which posts brought leads.
export default async function ContentPage(props: { searchParams: Promise<{ month?: string; view?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const write = can(user.role, "growth:write");
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : thisMonth();
  const view = sp.view === "board" ? "board" : "calendar";
  const [start, end] = monthRange(month);
  const [rows, people, camps] = await Promise.all([
    listContent(db, view === "board" ? { from: new Date(0), to: new Date("2999-01-01") } : { from: start, to: end }),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    db.select({ id: campaigns.id, label: campaigns.label }).from(campaigns).orderBy(asc(campaigns.label)),
  ]);
  const dated = rows.filter((r) => r.publishAt);
  const ideas = rows.filter((r) => !r.publishAt);

  // Monday-first weeks covering the month, on the Cairo calendar
  const first = `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const lastDay = cairoYmd(new Date(end.getTime() - 3600_000));
  const days: string[] = [];
  for (let d = addDaysYmd(first, -lead); d <= lastDay || days.length % 7; d = addDaysYmd(d, 1)) days.push(d);
  const today = cairoYmd(new Date());
  const [y, m] = month.split("-").map(Number);
  const here = `/growth/content?view=${view}&month=${month}`;

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Content"
        subtitle="Plan posts by month, move them through production on the board, and see which ones brought leads (through their tracked link)."
      />
      <Flash notice={sp.notice} error={sp.error} />
      <Tabs
        current={`/growth/content?view=${view}`}
        items={[
          { href: "/growth/content?view=calendar", label: "Calendar" },
          { href: "/growth/content?view=board", label: "Board", count: rows.filter((r) => r.status !== "posted").length },
        ]}
      />

      {view === "calendar" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card
            title={`${MONTHS[m - 1]} ${y}`}
            icon="calendar"
            actions={
              <span className="flex gap-1">
                <Link href={`/growth/content?view=calendar&month=${shiftMonth(month, -1)}`} className="btn btn-ghost btn-sm" aria-label="Previous month">
                  <Icon name="chevronLeft" size={14} />
                </Link>
                <Link href={`/growth/content?view=calendar&month=${shiftMonth(month, 1)}`} className="btn btn-ghost btn-sm" aria-label="Next month">
                  <Icon name="chevronRight" size={14} />
                </Link>
              </span>
            }
            bodyClass="p-0"
          >
            {/* scrolls sideways on a phone: focusable so it can be scrolled from the keyboard */}
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Content calendar for ${MONTHS[m - 1]} ${y}`}>
              <div aria-hidden="true" className="grid min-w-[760px] grid-cols-7 border-t border-line text-xs">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="border-b border-line px-2 py-1.5 font-medium text-muted">
                    {d}
                  </div>
                ))}
              </div>
              <ol className="grid min-w-[760px] grid-cols-7 text-xs">
                {days.map((d) => {
                  const items = dated.filter((c) => cairoYmd(c.publishAt!) === d);
                  const inMonth = d.startsWith(month);
                  return (
                    <li key={d} className={`min-h-[96px] border-b border-r border-line p-1.5 ${inMonth ? "" : "bg-raised/40"}`}>
                      <div className={`mb-1 text-[11px] ${d === today ? "font-semibold text-accent" : "text-muted"}`}>
                        <span aria-hidden="true">{Number(d.slice(8))}</span>
                        <span className="sr-only">{new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}{items.length ? `, ${items.length} planned` : ""}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        {items.map((c) => (
                          <Piece key={c.id} c={c} compact />
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Card>
          <div className="flex flex-col gap-6">
            <Card title={`Ideas without a date (${ideas.length})`} icon="sparkle">
              {ideas.length === 0 ? <p className="text-sm text-muted">None.</p> : <div className="flex flex-col gap-2">{ideas.map((c) => <Piece key={c.id} c={c} />)}</div>}
            </Card>
            {write && (
              <Card title="Plan a piece" icon="plus">
                <ContentForm people={people} campaigns={camps} me={user.id} back={here} />
              </Card>
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-w-0 gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(6,minmax(220px,1fr))]" tabIndex={0} role="region" aria-label="Content board by status">
          {ORDER.map((st, i) => {
            const col = rows.filter((r) => r.status === st);
            const next = ORDER[i + 1];
            return (
              <section key={st} aria-label={STATUSES[st]} className="card flex flex-col p-2">
                <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-medium">
                  {STATUSES[st]} <span className="count">{col.length}</span>
                </h2>
                {col.length === 0 && <EmptyState icon="sparkle" title="Empty" />}
                <ul className="flex flex-col gap-2">
                  {col.map((c) => (
                    <li key={c.id}>
                      <Piece c={c} />
                      {write && next && (
                        <form action={contentStatusAction} className="mt-1">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="status" value={next} />
                          <input type="hidden" name="back" value="/growth/content?view=board" />
                          <button className="btn btn-ghost btn-sm w-full justify-center" aria-label={`Move ${c.title} to ${STATUSES[next]}`}>
                            {STATUSES[next]} <Icon name="arrowRight" size={12} />
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
