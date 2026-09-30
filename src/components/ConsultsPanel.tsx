import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { consults, objections } from "@/db/schema";
import { bookConsultAction, confirmConsultAction, markConsultAction, rescheduleConsultAction } from "@/app/(app)/consults/actions";
import { consultObjectionIds } from "@/lib/consults";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { Card, EmptyState, Icon } from "./ui";

const TIERS = [
  ["foundation", "Foundation"],
  ["freelance_ready", "Freelance Ready"],
  ["production_partner", "Production Partner"],
] as const;

export async function ConsultsPanel({ leadId, canWrite }: { leadId: number; canWrite: boolean }) {
  const [rows, tags] = await Promise.all([
    db.select().from(consults).where(eq(consults.leadId, leadId)).orderBy(desc(consults.scheduledAt)),
    db.select().from(objections).orderBy(asc(objections.id)),
  ]);
  const chosen = await consultObjectionIds(db, rows.map((r) => r.id));
  const label = (id: number) => tags.find((t) => t.id === id)?.label ?? "";
  const now = new Date();

  return (
    <Card title="Consults" icon="phone" bodyClass="p-0">
      {rows.length === 0 && <EmptyState icon="phone" title="No consults yet" />}
      <ul className="divide-y divide-line/70">
        {rows.map((c) => {
          const status = c.held
            ? `Held · ${c.outcome?.replace("_", " ")}`
            : c.outcome === "no_show"
              ? "No-show"
              : now > c.scheduledAt
                ? "Awaiting result"
                : "Scheduled";
          const tone = c.held ? "chip-ok" : c.outcome === "no_show" ? "chip-danger" : status === "Awaiting result" ? "chip-warn" : "chip-gold";
          const tier = TIERS.find(([k]) => k === c.recommendedTier)?.[1];
          return (
            <li key={c.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="num flex items-center gap-2 font-medium">
                  <Icon name="calendar" size={14} className="text-muted" />
                  {formatCairo(c.scheduledAt)}
                </span>
                <span className="flex items-center gap-1.5">
                  {!c.held && c.outcome !== "no_show" && (
                    <span className={`chip ${c.confirmedAt ? "chip-ok" : ""}`}>{c.confirmedAt ? "confirmed" : "not confirmed"}</span>
                  )}
                  <span className={`chip ${tone}`}>{status}</span>
                </span>
              </div>
              {(tier || (chosen.get(c.id) ?? []).length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {tier && <span className="chip chip-gold">recommended: {tier}</span>}
                  {(chosen.get(c.id) ?? []).map((id) => (
                    <span key={id} className="chip">
                      {label(id)}
                    </span>
                  ))}
                </div>
              )}
              {c.notes && (
                <p dir="auto" className="mt-2 whitespace-pre-wrap text-xs text-muted">
                  {c.notes}
                </p>
              )}
              {canWrite && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {!c.held && c.outcome !== "no_show" && (
                    <form action={confirmConsultAction}>
                      <input type="hidden" name="consultId" value={c.id} />
                      <input type="hidden" name="leadId" value={leadId} />
                      <input type="hidden" name="confirmed" value={c.confirmedAt ? "0" : "1"} />
                      <button className="btn btn-ghost btn-sm">{c.confirmedAt ? "Unconfirm" : "Lead confirmed"}</button>
                    </form>
                  )}
                  <details className="w-full">
                    <summary className="btn btn-ghost btn-sm w-fit cursor-pointer list-none">
                      <Icon name="edit" size={13} />
                      {c.held || c.outcome ? "Edit result" : "Record result"}
                    </summary>
                    <form action={markConsultAction} className="well mt-2 flex flex-col gap-3 p-3">
                      <input type="hidden" name="consultId" value={c.id} />
                      <input type="hidden" name="leadId" value={leadId} />
                      <div className="grid grid-cols-2 gap-2">
                        <label className="field">
                          Result
                          <select name="result" defaultValue={c.outcome === "no_show" ? "no_show" : "held"} className="input">
                            <option value="held">Held</option>
                            <option value="no_show">No-show</option>
                          </select>
                        </label>
                        <label className="field">
                          Outcome (if held)
                          <select name="outcome" defaultValue={c.held ? (c.outcome ?? "") : ""} className="input">
                            <option value="">Outcome…</option>
                            <option value="enrolled">Said yes (enrol via the stage bar)</option>
                            <option value="thinking">Thinking</option>
                            <option value="not_fit">Not a fit</option>
                          </select>
                        </label>
                        <label className="field col-span-2">
                          Tier you recommended
                          <select name="recommendedTier" defaultValue={c.recommendedTier ?? ""} className="input">
                            <option value="">Not recorded</option>
                            {TIERS.map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                        <legend className="mb-1.5 font-medium text-muted">Objections raised</legend>
                        {tags.map((t) => (
                          <label key={t.id} className="flex items-center gap-1.5">
                            <input type="checkbox" className="check" name="objectionIds" value={t.id} defaultChecked={(chosen.get(c.id) ?? []).includes(t.id)} />
                            {t.label}
                          </label>
                        ))}
                      </fieldset>
                      <textarea name="notes" defaultValue={c.notes ?? ""} rows={2} dir="auto" placeholder="Notes" aria-label="Consult notes" className="input" />
                      <button className="btn btn-primary self-start">Save result</button>
                    </form>
                    {!c.held && (
                      <form action={rescheduleConsultAction} className="mt-2 flex items-center gap-2">
                        <input type="hidden" name="consultId" value={c.id} />
                        <input type="hidden" name="leadId" value={leadId} />
                        <input type="datetime-local" name="when" required defaultValue={toCairoLocalInput(c.scheduledAt)} className="input input-sm w-auto" aria-label="New time" />
                        <button className="btn btn-secondary btn-sm">Reschedule</button>
                      </form>
                    )}
                  </details>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canWrite && (
        <form action={bookConsultAction} className="flex flex-col gap-2 border-t border-line bg-bg/30 px-4 py-3">
          <input type="hidden" name="leadId" value={leadId} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="field">
              Book a consult (Cairo time)
              <input type="datetime-local" name="when" required className="input" />
            </label>
            <input name="notes" placeholder="Notes" aria-label="Notes" dir="auto" className="input min-w-0 flex-1" />
            <button className="btn btn-primary">
              <Icon name="plus" size={14} /> Book
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" name="confirmed" className="check" /> The lead confirmed this date and time
          </label>
        </form>
      )}
    </Card>
  );
}
