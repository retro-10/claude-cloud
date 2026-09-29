import { asc } from "drizzle-orm";
import { db } from "@/db";
import { stages } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { requirePageCan } from "@/lib/server-auth";
import { moveStageAction, renameStageAction } from "../actions";

export const metadata = { title: "Pipeline stages · Settings" };
const box = "rounded border border-line bg-bg px-2 py-1.5 text-sm";
const KIND: Record<string, string> = { open: "open", won: "won (enrolment)", lost: "lost (needs a reason)", nurture: "nurture" };

export default async function PipelineSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  await requirePageCan("settings:write");
  const list = await db.select().from(stages).orderBy(asc(stages.position));
  return (
    <>
      <Flash {...searchParams} />
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Rename stages and change their order. The order sets the board columns, the funnel order, and which stage counts as &quot;earlier&quot; when
        a consult moves a lead forward. The nine built-in stages cannot be removed, and each keeps its behaviour (won, lost) whatever its label.
      </p>
      <ol className="flex max-w-2xl flex-col gap-2">
        {list.map((s, i) => (
          <li key={s.key} className="flex flex-wrap items-center gap-2 rounded border border-line bg-surface p-2">
            <span className="w-6 text-right text-xs text-muted">{i + 1}</span>
            <form action={renameStageAction} className="flex flex-1 items-center gap-2">
              <input type="hidden" name="key" value={s.key} />
              <input name="label" defaultValue={s.label} required maxLength={60} dir="auto" aria-label={`Label for stage ${s.key}`} className={`${box} min-w-0 flex-1`} />
              <button className="rounded border border-line px-2 py-1.5 text-sm hover:border-gold">Rename</button>
            </form>
            <span className="text-xs text-muted">{KIND[s.kind]}</span>
            <form action={moveStageAction}>
              <input type="hidden" name="key" value={s.key} />
              <button name="direction" value="up" disabled={i === 0} aria-label={`Move ${s.label} up`} className="rounded border border-line px-2 py-1 text-sm disabled:opacity-30">
                ↑
              </button>
              <button name="direction" value="down" disabled={i === list.length - 1} aria-label={`Move ${s.label} down`} className="ml-1 rounded border border-line px-2 py-1 text-sm disabled:opacity-30">
                ↓
              </button>
            </form>
          </li>
        ))}
      </ol>
    </>
  );
}
