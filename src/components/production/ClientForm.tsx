import { saveClientAction } from "@/app/(app)/production/actions";
import { CLIENT_KIND } from "@/lib/production";

type Client = { id: number; name: string; kind: keyof typeof CLIENT_KIND; contactName: string | null; phone: string | null; email: string | null; address: string | null; discountPct: number; paymentTermsDays: number; notes: string | null; active: boolean };

/** Add or edit a clinic or lab. */
export function ClientForm({ c }: { c?: Client }) {
  return (
    <form action={saveClientAction} className="grid gap-3 sm:grid-cols-2">
      {c && <input type="hidden" name="id" value={c.id} />}
      <input type="hidden" name="back" value={c ? `/production/clients/${c.id}` : "/production/clients"} />
      <label className="field">
        Name
        <input name="name" required maxLength={200} defaultValue={c?.name} dir="auto" className="input" placeholder="Smile Dental Clinic" />
      </label>
      <label className="field">
        Kind
        <select name="kind" defaultValue={c?.kind ?? "clinic"} className="input">
          {Object.entries(CLIENT_KIND).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Contact person
        <input name="contactName" maxLength={200} defaultValue={c?.contactName ?? ""} dir="auto" className="input" />
      </label>
      <label className="field">
        Phone
        <input name="phone" type="tel" maxLength={40} defaultValue={c?.phone ?? ""} dir="ltr" className="input" placeholder="+20 10 0000 0000" />
      </label>
      <label className="field">
        Email
        <input name="email" type="email" maxLength={200} defaultValue={c?.email ?? ""} dir="ltr" className="input" />
      </label>
      <label className="field">
        Address
        <input name="address" maxLength={500} defaultValue={c?.address ?? ""} dir="auto" className="input" />
      </label>
      <label className="field">
        Discount on the price list (%)
        <input name="discountPct" type="number" min={0} max={50} required defaultValue={c?.discountPct ?? 0} className="input num" />
      </label>
      <label className="field">
        Pays within (days of the invoice)
        <input name="paymentTermsDays" type="number" min={0} max={120} required defaultValue={c?.paymentTermsDays ?? 14} className="input num" />
      </label>
      <label className="field sm:col-span-2">
        Notes (terms, file formats, who to send to)
        <textarea name="notes" rows={2} maxLength={4000} defaultValue={c?.notes ?? ""} dir="auto" className="input" />
      </label>
      {c && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="active" defaultChecked={c.active} /> Active (can send new cases)
        </label>
      )}
      <button className="btn btn-primary btn-sm self-start justify-self-start">{c ? "Save" : "Add client"}</button>
    </form>
  );
}
