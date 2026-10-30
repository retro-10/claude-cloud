import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Avatar, Card, Icon, PageHeader } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/announcements";
import { hours, presence } from "@/lib/calendar";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { asc, eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { openDmAction } from "../chat/actions";

export const metadata = { title: "People" };

const STATE: Record<string, { label: string; tone: string }> = {
  working: { label: "Working", tone: "chip-ok" },
  aux: { label: "Away", tone: "chip-warn" },
  busy: { label: "Busy", tone: "chip-warn" },
  away: { label: "Off", tone: "chip-danger" },
  off: { label: "Not working", tone: "" },
};

// The team directory: everyone with an account, their role, how to reach them and what they are doing now.
export default async function PeoplePage(props: { searchParams: Promise<{ q?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("comms:read");
  const [people, emails] = await Promise.all([presence(db), db.select({ id: users.id, email: users.email }).from(users).where(eq(users.active, true)).orderBy(asc(users.name))]);
  const q = (sp.q ?? "").trim().toLowerCase();
  const shown = people.filter((p) => !q || p.name.toLowerCase().includes(q) || ROLE_LABEL[p.role].toLowerCase().includes(q));
  const chat = can(user.role, "chat:write");
  const emailOf = new Map(emails.map((e) => [e.id, e.email]));
  return (
    <>
      <PageHeader eyebrow="HQ" title="People" subtitle="Everyone on the team, their role, and whether they are working right now." />
      <Flash {...sp} />
      <form method="get" className="mb-4 max-w-sm">
        <label className="sr-only" htmlFor="people-q">
          Find a person or a team
        </label>
        <input id="people-q" name="q" defaultValue={sp.q ?? ""} placeholder="Find a person or a team" className="input" />
      </form>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((p) => {
          const st = STATE[p.state] ?? STATE.off;
          return (
            <Card key={p.id}>
              <div className="flex items-start gap-3">
                <Avatar name={p.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {p.name}
                    {p.id === user.id && <span className="font-normal text-muted"> (you)</span>}
                  </div>
                  <div className="text-xs text-muted">{ROLE_LABEL[p.role]}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`chip ${st.tone}`}>
                      {p.state === "aux" && p.aux ? p.aux.label : p.state === "away" && p.current ? p.current.title : st.label}
                    </span>
                    {p.todayMinutes > 0 && <span className="text-muted">{hours(p.todayMinutes)} today</span>}
                  </div>
                  <a href={`mailto:${emailOf.get(p.id)}`} className="mt-2 block truncate text-xs text-muted hover:text-fg" dir="ltr">
                    {emailOf.get(p.id)}
                  </a>
                </div>
                {chat && p.id !== user.id && (
                  <form action={openDmAction}>
                    <input type="hidden" name="people" value={p.id} />
                    <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Message ${p.name}`} title={`Message ${p.name}`}>
                      <Icon name="chat" size={16} />
                    </button>
                  </form>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
