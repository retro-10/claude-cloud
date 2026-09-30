import { deleteProofAction, deleteSessionAction, saveProofAction, saveSessionAction, updateProgrammeAction } from "@/app/(app)/programme/actions";
import type { CandidateRow } from "@/lib/finance";
import { CONSENT_SCOPES, PROOF_CONSENT, PROOF_TYPES, SESSION_TYPES, USABLE_IN, WEEKDAYS } from "@/lib/programme";
import type { programmeSessions, proofItems } from "@/db/schema";
import { ConfirmButton } from "../ConfirmButton";
import { Icon } from "../ui";

type Session = typeof programmeSessions.$inferSelect;
type Proof = typeof proofItems.$inferSelect;

const CONSENT_CHIP: Record<string, string> = { Granted: "chip-ok", Asked: "chip-warn", Declined: "chip-danger" };

function Options({ list, empty = "—" }: { list: readonly string[]; empty?: string }) {
  return (
    <>
      <option value="">{empty}</option>
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </>
  );
}

function SessionForm({ s, enrolmentId, back }: { s?: Session; enrolmentId: number; back: string }) {
  return (
    <form action={saveSessionAction} className="grid grid-cols-2 gap-2 pt-2 text-sm">
      {s && <input type="hidden" name="id" value={s.id} />}
      <input type="hidden" name="enrolmentId" value={enrolmentId} />
      <input type="hidden" name="back" value={back} />
      <label className="field col-span-2">
        Name
        <input name="name" required maxLength={200} defaultValue={s?.name} placeholder="e.g. 1:1 week 3" dir="auto" className="input input-sm" />
      </label>
      <label className="field">
        Type
        <select name="type" defaultValue={s?.type ?? ""} className="input input-sm">
          <Options list={SESSION_TYPES} />
        </select>
      </label>
      <label className="field">
        Day
        <select name="dayOfWeek" defaultValue={s?.dayOfWeek ?? ""} className="input input-sm">
          <Options list={WEEKDAYS} />
        </select>
      </label>
      <label className="field">
        Time
        <input name="time" maxLength={40} defaultValue={s?.time ?? ""} placeholder="8:00 pm" className="input input-sm" />
      </label>
      <label className="field">
        Recording link
        <input name="driveLink" type="url" defaultValue={s?.driveLink ?? ""} placeholder="https://" dir="ltr" className="input input-sm" />
      </label>
      <label className="field col-span-2">
        Notes
        <textarea name="notes" rows={2} defaultValue={s?.notes ?? ""} dir="auto" className="input input-sm" />
      </label>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" name="recorded" defaultChecked={s?.recorded} className="check" /> Recorded
      </label>
      <div className="flex justify-end">
        <button className="btn btn-secondary btn-sm">{s ? "Save" : "Add session"}</button>
      </div>
    </form>
  );
}

function ProofForm({ p, enrolmentId, back }: { p?: Proof; enrolmentId: number; back: string }) {
  return (
    <form action={saveProofAction} className="grid grid-cols-2 gap-2 pt-2 text-sm">
      {p && <input type="hidden" name="id" value={p.id} />}
      <input type="hidden" name="enrolmentId" value={enrolmentId} />
      <input type="hidden" name="back" value={back} />
      <label className="field col-span-2">
        Name
        <input name="name" required maxLength={200} defaultValue={p?.name} placeholder="e.g. First client voice note" dir="auto" className="input input-sm" />
      </label>
      <label className="field">
        Type
        <select name="type" defaultValue={p?.type ?? ""} className="input input-sm">
          <Options list={PROOF_TYPES} />
        </select>
      </label>
      <label className="field">
        Consent
        <select name="consentStatus" defaultValue={p?.consentStatus ?? "Not asked"} className="input input-sm">
          {PROOF_CONSENT.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="field col-span-2">
        File or link
        <input name="fileOrLink" type="url" defaultValue={p?.fileOrLink ?? ""} placeholder="https://" dir="ltr" className="input input-sm" />
      </label>
      <label className="field col-span-2">
        Real quote or transcript (word for word)
        <textarea name="quote" rows={3} defaultValue={p?.quote ?? ""} dir="auto" className="input input-sm" />
      </label>
      <fieldset className="col-span-2 flex flex-wrap gap-3 text-xs">
        <legend className="mb-1 text-muted">Usable in</legend>
        {USABLE_IN.map((u) => (
          <label key={u} className="flex items-center gap-1.5">
            <input type="checkbox" name="usableIn" value={u} defaultChecked={p?.usableIn.includes(u)} className="check" /> {u}
          </label>
        ))}
      </fieldset>
      <div className="col-span-2 flex justify-end">
        <button className="btn btn-secondary btn-sm">{p ? "Save" : "Add item"}</button>
      </div>
    </form>
  );
}

/**
 * A student's programme record, kept in step with the Notion Candidates, Sessions and Proof & Testimonial Bank:
 * content consent (may we use their work and words), QC score, leaderboard rank, sessions, proof.
 */
export function ProgrammeCard({ c, sessions, proof, canWrite, back }: { c: CandidateRow; sessions: Session[]; proof: Proof[]; canWrite: boolean; back: string }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-3 gap-2">
        <div className="well px-3 py-2">
          <div className="text-xs text-muted">QC score</div>
          <div className="num font-semibold">{c.qcScore ?? "—"}</div>
        </div>
        <div className="well px-3 py-2">
          <div className="text-xs text-muted">Leaderboard</div>
          <div className="num font-semibold">{c.leaderboardRank ? `#${c.leaderboardRank}` : "—"}</div>
        </div>
        <div className="well px-3 py-2">
          <div className="text-xs text-muted">Content consent</div>
          <div className={`font-semibold ${c.contentConsent ? "text-ok" : "text-warn"}`}>{c.contentConsent ? "On file" : "Not on file"}</div>
          {c.contentConsent && c.contentConsentScope.length > 0 && <div className="text-[11px] text-muted">{c.contentConsentScope.join(", ")}</div>}
        </div>
      </div>

      {canWrite && (
        <details className="rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-fg">Edit QC, rank and consent</summary>
          <form action={updateProgrammeAction} className="grid grid-cols-2 gap-2 pt-2">
            <input type="hidden" name="enrolmentId" value={c.enrolmentId} />
            <input type="hidden" name="back" value={back} />
            <label className="field">
              QC score
              <input name="qcScore" type="number" step="0.01" min={0} defaultValue={c.qcScore ?? ""} className="input input-sm num" />
            </label>
            <label className="field">
              Leaderboard rank
              <input name="leaderboardRank" type="number" min={1} step={1} defaultValue={c.leaderboardRank ?? ""} className="input input-sm num" />
            </label>
            <label className="col-span-2 flex items-center gap-2 text-xs">
              <input type="checkbox" name="contentConsent" defaultChecked={c.contentConsent} className="check" /> Consent on file (we may use their work and words in content)
            </label>
            <fieldset className="col-span-2 flex flex-wrap gap-3 text-xs">
              <legend className="mb-1 text-muted">Consent covers</legend>
              {CONSENT_SCOPES.map((sc) => (
                <label key={sc} className="flex items-center gap-1.5">
                  <input type="checkbox" name="contentConsentScope" value={sc} defaultChecked={c.contentConsentScope.includes(sc)} className="check" /> {sc}
                </label>
              ))}
            </fieldset>
            <div className="col-span-2 flex justify-end">
              <button className="btn btn-secondary btn-sm">Save</button>
            </div>
          </form>
        </details>
      )}

      <section aria-label="Sessions">
        <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <Icon name="calendar" size={13} /> Sessions ({sessions.length})
        </h3>
        <ul className="divide-y divide-line/70 rounded-lg border border-line">
          {sessions.length === 0 && <li className="px-3 py-2.5 text-muted">No sessions yet.</li>}
          {sessions.map((s) => (
            <li key={s.id} className="px-3 py-2">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-medium" dir="auto">
                    {s.name}
                  </span>
                  <span className="text-xs text-muted">{[s.type, s.dayOfWeek, s.time].filter(Boolean).join(" · ")}</span>
                  {s.recorded && <span className="chip chip-ok">recorded</span>}
                  {s.driveLink && (
                    <a href={s.driveLink} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                      recording
                    </a>
                  )}
                </summary>
                {s.notes && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted" dir="auto">
                    {s.notes}
                  </p>
                )}
                {canWrite && (
                  <>
                    <SessionForm s={s} enrolmentId={c.enrolmentId} back={back} />
                    <form action={deleteSessionAction} className="mt-1 flex justify-end">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="back" value={back} />
                      <ConfirmButton message="Delete this session? It is removed here and in Notion." className="btn btn-ghost btn-sm text-muted hover:text-danger">
                        <Icon name="trash" size={13} /> Delete
                      </ConfirmButton>
                    </form>
                  </>
                )}
              </details>
            </li>
          ))}
        </ul>
        {canWrite && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-accent">+ Add a session</summary>
            <SessionForm enrolmentId={c.enrolmentId} back={back} />
          </details>
        )}
      </section>

      <section aria-label="Proof and testimonials">
        <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <Icon name="sparkle" size={13} /> Proof & testimonials ({proof.length})
        </h3>
        <ul className="divide-y divide-line/70 rounded-lg border border-line">
          {proof.length === 0 && <li className="px-3 py-2.5 text-muted">Nothing collected yet.</li>}
          {proof.map((p) => (
            <li key={p.id} className="px-3 py-2">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-medium" dir="auto">
                    {p.name}
                  </span>
                  {p.type && <span className="text-xs text-muted">{p.type}</span>}
                  <span className={`chip ${CONSENT_CHIP[p.consentStatus ?? ""] ?? ""}`}>{p.consentStatus ?? "Not asked"}</span>
                  {p.usableIn.length > 0 && <span className="text-xs text-muted">for {p.usableIn.join(", ")}</span>}
                </summary>
                {p.quote && (
                  <blockquote className="mt-2 border-l-2 border-brand/50 pl-3 text-xs italic text-fg/90" dir="auto">
                    {p.quote}
                  </blockquote>
                )}
                {p.fileOrLink && (
                  <a href={p.fileOrLink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-accent hover:underline">
                    Open file
                  </a>
                )}
                {canWrite && (
                  <>
                    <ProofForm p={p} enrolmentId={c.enrolmentId} back={back} />
                    <form action={deleteProofAction} className="mt-1 flex justify-end">
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="back" value={back} />
                      <ConfirmButton message="Delete this item? It is removed here and in Notion." className="btn btn-ghost btn-sm text-muted hover:text-danger">
                        <Icon name="trash" size={13} /> Delete
                      </ConfirmButton>
                    </form>
                  </>
                )}
              </details>
            </li>
          ))}
        </ul>
        {canWrite && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-accent">+ Add proof or a testimonial</summary>
            <ProofForm enrolmentId={c.enrolmentId} back={back} />
          </details>
        )}
      </section>
    </div>
  );
}
