import { asc } from "drizzle-orm";
import { db } from "@/db";
import { cadenceTemplates } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { requirePageCan } from "@/lib/server-auth";
import { STEP_KINDS, stepsToText } from "@/lib/settings";
import { deleteTemplateAction, saveTemplateAction } from "../actions";

export const metadata = { title: "Cadences · Settings" };
const box = "rounded border border-line bg-bg px-2 py-1.5 text-sm";

export default async function CadenceSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  await requirePageCan("settings:write");
  const list = await db.select().from(cadenceTemplates).orderBy(asc(cadenceTemplates.id));
  return (
    <>
      <Flash {...searchParams} />
      <p className="mb-4 max-w-2xl text-sm text-muted">
        One step per line: <code>day | kind | message hint</code>. Day 0 is the day the cadence is started; kinds are {STEP_KINDS.join(", ")}. The
        hint is shown on the follow-up as a suggestion and is never sent. Editing a template only affects cadences started afterwards.
      </p>
      <div className="flex max-w-3xl flex-col gap-4">
        {list.map((t) => (
          <section key={t.id} className="rounded border border-line bg-surface p-3">
            <form action={saveTemplateAction} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={t.id} />
              <label className="flex flex-col gap-1 text-xs text-muted">
                Name
                <input name="name" defaultValue={t.name} required maxLength={80} dir="auto" className={box} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Steps
                <textarea name="steps" defaultValue={stepsToText(t.steps)} rows={Math.max(4, t.steps.length + 1)} required dir="auto" className={`${box} font-mono`} />
              </label>
              <div className="flex gap-2">
                <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Save</button>
              </div>
            </form>
            <form action={deleteTemplateAction} className="mt-2">
              <input type="hidden" name="id" value={t.id} />
              <button className="text-xs text-muted underline hover:text-danger">Delete this template</button>
            </form>
          </section>
        ))}
        <section className="rounded border border-line bg-surface p-3">
          <form action={saveTemplateAction} className="flex flex-col gap-2">
            <h2 className="font-display text-lg">New template</h2>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Name
              <input name="name" required maxLength={80} dir="auto" className={box} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Steps
              <textarea name="steps" rows={4} required dir="auto" placeholder={"0 | whatsapp | Warm-up\n3 | whatsapp | Value clip"} className={`${box} font-mono`} />
            </label>
            <div>
              <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Create</button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
