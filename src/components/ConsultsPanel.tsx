import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { consults, objections } from "@/db/schema";
import { consultObjectionIds } from "@/lib/consults";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { bookConsultAction, markConsultAction, rescheduleConsultAction } from "@/app/(app)/consults/actions";

const box = "rounded border border-line bg-bg px-2 py-1.5 text-sm";

export async function ConsultsPanel({ leadId, canWrite }: { leadId: number; canWrite: boolean }) {
  const [rows, tags] = await Promise.all([
    db.select().from(consults).where(eq(consults.leadId, leadId)).orderBy(desc(consults.scheduledAt)),
    db.select().from(objections).orderBy(asc(objections.id)),
  ]);
  const chosen = await consultObjectionIds(db, rows.map((r) => r.id));
  const label = (id: number) => tags.find((t) => t.id === id)?.label ?? "";

  return (
    <div className="mb-5">
      <h2 className="mb-2 font-display text-lg">Consults</h2>
      <div className="rounded border border-line bg-surface p-3">
        {rows.length === 0 && <p className="mb-2 text-sm text-muted">No consults yet.</p>}
        <ul className="flex flex-col gap-3">
          {rows.map((c) => {
            const status = c.held ? `Held · ${c.outcome?.replace("_", " ")}` : c.outcome === "no_show" ? "No-show" : new Date() > c.scheduledAt ? "Awaiting result" : "Scheduled";
            return (
              <li key={c.id} className="text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>{formatCairo(c.scheduledAt)}</span>
                  <span className={`text-xs ${status === "Awaiting result" ? "text-warn" : "text-muted"}`}>{status}</span>
                </div>
                {(chosen.get(c.id) ?? []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {chosen.get(c.id)!.map((id) => (
                      <span key={id} className="rounded bg-bg px-1.5 py-0.5 text-xs text-muted">
                        {label(id)}
                      </span>
                    ))}
                  </div>
                )}
                {c.notes && (
                  <p dir="auto" className="mt-1 whitespace-pre-wrap text-xs text-muted">
                    {c.notes}
                  </p>
                )}
                {canWrite && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted hover:text-fg">{c.held || c.outcome ? "Edit result" : "Record result"}</summary>
                    <form action={markConsultAction} className="mt-2 flex flex-col gap-2 rounded border border-line bg-bg p-2">
                      <input type="hidden" name="consultId" value={c.id} />
                      <input type="hidden" name="leadId" value={leadId} />
                      <div className="flex flex-wrap gap-2">
                        <select name="result" defaultValue={c.outcome === "no_show" ? "no_show" : "held"} className={box} aria-label="Result">
                          <option value="held">Held</option>
                          <option value="no_show">No-show</option>
                        </select>
                        <select name="outcome" defaultValue={c.held ? (c.outcome ?? "") : ""} className={box} aria-label="Outcome (if held)">
                          <option value="">Outcome…</option>
                          <option value="enrolled">Said yes (enrol via Pipeline)</option>
                          <option value="thinking">Thinking</option>
                          <option value="not_fit">Not a fit</option>
                        </select>
                      </div>
                      <fieldset className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <legend className="mb-1 text-muted">Objections raised</legend>
                        {tags.map((t) => (
                          <label key={t.id} className="flex items-center gap-1">
                            <input type="checkbox" name="objectionIds" value={t.id} defaultChecked={(chosen.get(c.id) ?? []).includes(t.id)} />
                            {t.label}
                          </label>
                        ))}
                      </fieldset>
                      <textarea name="notes" defaultValue={c.notes ?? ""} rows={2} dir="auto" placeholder="Notes" className={box} />
                      <button className="self-start rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Save result</button>
                    </form>
                    {!c.held && (
                      <form action={rescheduleConsultAction} className="mt-2 flex items-center gap-2 text-xs">
                        <input type="hidden" name="consultId" value={c.id} />
                        <input type="hidden" name="leadId" value={leadId} />
                        <input type="datetime-local" name="when" required defaultValue={toCairoLocalInput(c.scheduledAt)} className={box} aria-label="New time" />
                        <button className="rounded border border-line px-2 py-1 hover:border-gold">Reschedule</button>
                      </form>
                    )}
                  </details>
                )}
              </li>
            );
          })}
        </ul>
        {canWrite && (
          <form action={bookConsultAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <input type="hidden" name="leadId" value={leadId} />
            <label className="flex flex-col gap-1 text-xs text-muted">
              Book a consult (Cairo time)
              <input type="datetime-local" name="when" required className={box} />
            </label>
            <input name="notes" placeholder="Notes" dir="auto" className={`${box} min-w-0 flex-1`} />
            <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Book</button>
          </form>
        )}
      </div>
    </div>
  );
}
