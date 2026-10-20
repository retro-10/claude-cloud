import { addDecisionAction } from "@/app/(app)/team/actions";

/** Log a decision: what, who owns it, by when. */
export function DecisionForm({ people, meetingId, back }: { people: { id: number; name: string }[]; meetingId?: number; back: string }) {
  return (
    <form action={addDecisionAction} className="grid gap-3 sm:grid-cols-2">
      {meetingId && <input type="hidden" name="meetingId" value={meetingId} />}
      <input type="hidden" name="back" value={back} />
      <label className="field sm:col-span-2">
        Decision
        <input name="title" required maxLength={300} dir="auto" className="input input-sm" placeholder="Raise the Foundation price to 8,500 EGP from Batch 9" />
      </label>
      <label className="field">
        Owner
        <select name="ownerId" defaultValue="" className="input input-sm">
          <option value="">Not set</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        By
        <input name="due" type="date" className="input input-sm" />
      </label>
      <label className="field sm:col-span-2">
        Details (optional)
        <textarea name="detail" rows={2} maxLength={4000} dir="auto" className="input" />
      </label>
      <button className="btn btn-primary btn-sm justify-self-start">Log the decision</button>
    </form>
  );
}
