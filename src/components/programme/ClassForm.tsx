import { saveClassAction } from "@/app/(app)/classes/actions";
import { toCairoLocalInput } from "@/lib/time";

type Opt = { id: number; name: string };
type Item = { id: number; cohortId: number; title: string; module: string | null; startsAt: Date; durationMin: number; instructorId: number | null; location: string | null; recordingUrl: string | null; materialsUrl: string | null; notes: string | null };

/** Add or edit one class of a batch. */
export function ClassForm({ c, batches, people, back, cohortId }: { c?: Item; batches: Opt[]; people: Opt[]; back: string; cohortId?: number }) {
  return (
    <form action={saveClassAction} className="grid gap-3 sm:grid-cols-2">
      {c && <input type="hidden" name="id" value={c.id} />}
      <input type="hidden" name="back" value={back} />
      <label className="field sm:col-span-2">
        Batch
        <select name="cohortId" required defaultValue={c?.cohortId ?? cohortId ?? ""} className="input">
          <option value="" disabled>
            Choose
          </option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Class
        <input name="title" required maxLength={200} defaultValue={c?.title} dir="auto" className="input" placeholder="Crown design, part 1" />
      </label>
      <label className="field">
        Module (optional)
        <input name="module" maxLength={120} defaultValue={c?.module ?? ""} dir="auto" className="input" placeholder="Module 2: crowns" />
      </label>
      <label className="field">
        Starts (Cairo time)
        <input name="startsAt" type="datetime-local" required defaultValue={toCairoLocalInput(c?.startsAt)} className="input" />
      </label>
      <label className="field">
        Length (minutes)
        <input name="durationMin" type="number" min={15} max={600} step={15} required defaultValue={c?.durationMin ?? 120} className="input num" />
      </label>
      <label className="field">
        Instructor
        <select name="instructorId" defaultValue={c?.instructorId ?? ""} className="input">
          <option value="">Not set</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Room or meeting link
        <input name="location" maxLength={300} defaultValue={c?.location ?? ""} className="input" />
      </label>
      <label className="field">
        Materials link
        <input name="materialsUrl" type="url" defaultValue={c?.materialsUrl ?? ""} dir="ltr" className="input" placeholder="https://" />
      </label>
      <label className="field">
        Recording link (after the class)
        <input name="recordingUrl" type="url" defaultValue={c?.recordingUrl ?? ""} dir="ltr" className="input" placeholder="https://" />
      </label>
      <label className="field sm:col-span-2">
        Notes
        <textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} dir="auto" className="input" />
      </label>
      <div className="sm:col-span-2">
        <button className="btn btn-primary btn-sm">{c ? "Save class" : "Add class"}</button>
      </div>
    </form>
  );
}
