import { saveAssignmentAction } from "@/app/(app)/assignments/actions";
import { rubricText } from "@/lib/assignments";
import { toCairoLocalInput } from "@/lib/time";
import type { RubricCriterion } from "@/db/schema";

type Item = { id: number; cohortId: number; title: string; brief: string | null; dueAt: Date | null; rubric: RubricCriterion[]; passPct: number };

const DEFAULT_RUBRIC = "Margins and fit | 30\nOcclusion and contacts | 30\nAnatomy and contours | 25\nFile delivered as asked | 15";

/** Add or edit an assignment and its rubric. */
export function AssignmentForm({ a, batches, cohortId }: { a?: Item; batches: { id: number; name: string }[]; cohortId?: number }) {
  return (
    <form action={saveAssignmentAction} className="grid gap-3 sm:grid-cols-2">
      {a && <input type="hidden" name="id" value={a.id} />}
      <label className="field sm:col-span-2">
        Batch
        <select name="cohortId" required defaultValue={a?.cohortId ?? cohortId ?? ""} className="input">
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
      <label className="field sm:col-span-2">
        Assignment
        <input name="title" required maxLength={200} defaultValue={a?.title} dir="auto" className="input" placeholder="Case 3: anterior crown" />
      </label>
      <label className="field">
        Due (Cairo time)
        <input name="dueAt" type="datetime-local" defaultValue={toCairoLocalInput(a?.dueAt)} className="input" />
      </label>
      <label className="field">
        Pass mark (%)
        <input name="passPct" type="number" min={1} max={100} required defaultValue={a?.passPct ?? 70} className="input num" />
      </label>
      <label className="field sm:col-span-2">
        Brief
        <textarea name="brief" rows={4} defaultValue={a?.brief ?? ""} dir="auto" className="input" />
      </label>
      <label className="field sm:col-span-2">
        Rubric: one criterion per line, &ldquo;name | points&rdquo;
        <textarea name="rubric" rows={5} required defaultValue={a ? rubricText(a.rubric) : DEFAULT_RUBRIC} dir="auto" className="input num" />
      </label>
      <div className="sm:col-span-2">
        <button className="btn btn-primary btn-sm">{a ? "Save assignment" : "Add assignment"}</button>
      </div>
    </form>
  );
}
