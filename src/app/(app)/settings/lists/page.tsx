import { asc } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, lostReasons, objections, sources } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { requirePageCan } from "@/lib/server-auth";
import {
  addCampaignAction,
  addListItemAction,
  deleteCampaignAction,
  deleteListItemAction,
  renameCampaignAction,
  renameListItemAction,
} from "../actions";

export const metadata = { title: "Sources & reasons · Settings" };
const box = "rounded border border-line bg-bg px-2 py-1.5 text-sm";

function Item({ list, id, label }: { list: string; id: number; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <form action={renameListItemAction} className="flex flex-1 items-center gap-2">
        <input type="hidden" name="list" value={list} />
        <input type="hidden" name="id" value={id} />
        <input name="label" defaultValue={label} required maxLength={80} dir="auto" aria-label={`Rename ${label}`} className={`${box} min-w-0 flex-1`} />
        <button className="rounded border border-line px-2 py-1.5 text-sm hover:border-gold">Rename</button>
      </form>
      <form action={deleteListItemAction}>
        <input type="hidden" name="list" value={list} />
        <input type="hidden" name="id" value={id} />
        <button className="px-2 py-1.5 text-sm text-muted hover:text-danger" aria-label={`Delete ${label}`}>
          Delete
        </button>
      </form>
    </li>
  );
}

function Add({ list, what }: { list: string; what: string }) {
  return (
    <form action={addListItemAction} className="mt-3 flex items-center gap-2">
      <input type="hidden" name="list" value={list} />
      <input name="label" required maxLength={80} dir="auto" placeholder={`New ${what}`} aria-label={`New ${what}`} className={`${box} min-w-0 flex-1`} />
      <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Add</button>
    </form>
  );
}

export default async function ListsSettings({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  await requirePageCan("settings:write");
  const [src, reasons, objs, camps] = await Promise.all([
    db.select().from(sources).orderBy(asc(sources.id)),
    db.select().from(lostReasons).orderBy(asc(lostReasons.id)),
    db.select().from(objections).orderBy(asc(objections.id)),
    db.select().from(campaigns).orderBy(asc(campaigns.id)),
  ]);
  const card = "rounded border border-line bg-surface p-3";
  return (
    <>
      <Flash {...searchParams} />
      <p className="mb-4 max-w-2xl text-sm text-muted">
        A label that is already used by leads, consults or campaigns cannot be deleted (it would rewrite history); rename it instead.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-2 font-display text-lg">Sources</h2>
          <ul className="flex flex-col gap-2">{src.map((s) => <Item key={s.id} list="sources" id={s.id} label={s.label} />)}</ul>
          <Add list="sources" what="source" />
        </section>
        <section className={card}>
          <h2 className="mb-2 font-display text-lg">Lost reasons</h2>
          <ul className="flex flex-col gap-2">{reasons.map((s) => <Item key={s.id} list="lostReasons" id={s.id} label={s.label} />)}</ul>
          <Add list="lostReasons" what="lost reason" />
        </section>
        <section className={card}>
          <h2 className="mb-2 font-display text-lg">Objection tags</h2>
          <ul className="flex flex-col gap-2">{objs.map((s) => <Item key={s.id} list="objections" id={s.id} label={s.label} />)}</ul>
          <Add list="objections" what="objection tag" />
        </section>
        <section className={card}>
          <h2 className="mb-2 font-display text-lg">Campaigns</h2>
          <ul className="flex flex-col gap-2">
            {camps.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <form action={renameCampaignAction} className="flex flex-1 items-center gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <input name="label" defaultValue={c.label} required maxLength={80} dir="auto" aria-label={`Rename ${c.label}`} className={`${box} min-w-0 flex-1`} />
                  <span className="text-xs text-muted">{src.find((s) => s.id === c.sourceId)?.label}</span>
                  <button className="rounded border border-line px-2 py-1.5 text-sm hover:border-gold">Rename</button>
                </form>
                <form action={deleteCampaignAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="px-2 py-1.5 text-sm text-muted hover:text-danger" aria-label={`Delete ${c.label}`}>
                    Delete
                  </button>
                </form>
              </li>
            ))}
            {camps.length === 0 && <li className="text-sm text-muted">No campaigns yet.</li>}
          </ul>
          <form action={addCampaignAction} className="mt-3 flex flex-wrap items-center gap-2">
            <input name="label" required maxLength={80} dir="auto" placeholder="New campaign" aria-label="New campaign" className={`${box} min-w-0 flex-1`} />
            <select name="sourceId" defaultValue="" aria-label="Campaign source" className={box}>
              <option value="">No source</option>
              {src.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Add</button>
          </form>
        </section>
      </div>
    </>
  );
}
