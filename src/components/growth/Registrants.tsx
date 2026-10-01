"use client";

import Link from "next/link";
import { useState } from "react";
import { markRemindedAction, saveAttendanceAction } from "@/app/(app)/growth/events/actions";
import { whatsappPrefill } from "@/lib/templates-render";
import { Icon } from "../ui/Icon";

type Row = { id: number; fullName: string; phone: string | null; doNotContact: boolean; attended: boolean | null; reminded: boolean; consultedAfter: boolean; enrolled: boolean };

/** The registrant list: a reminder per person (opens WhatsApp with the text filled in), then attendance. */
export function Registrants({ campaignId, rows, defaultMessage, canWrite }: { campaignId: number; rows: Row[]; defaultMessage: string; canWrite: boolean }) {
  const [message, setMessage] = useState(defaultMessage);
  const text = (r: Row) => message.replaceAll("{name}", r.fullName.split(/\s+/)[0]);
  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <label className="field">
          Reminder message ({"{name}"} becomes their first name)
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className="input" dir="auto" />
        </label>
      )}
      <form action={saveAttendanceAction}>
        <input type="hidden" name="campaignId" value={campaignId} />
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Reminder</th>
                <th scope="col">Came?</th>
                <th scope="col">Afterwards</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const wa = !r.doNotContact ? whatsappPrefill(r.phone, text(r)) : null;
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/leads/${r.id}`} className="link" dir="auto">
                        {r.fullName}
                      </Link>
                    </td>
                    <td>
                      {r.reminded ? (
                        <span className="chip chip-ok">reminded</span>
                      ) : r.doNotContact ? (
                        <span className="chip chip-danger">do not contact</span>
                      ) : canWrite && wa ? (
                        <span className="flex items-center gap-1">
                          <a href={wa} target="_blank" rel="noreferrer" className="btn btn-wa btn-sm" aria-label={`Send the reminder to ${r.fullName} on WhatsApp`}>
                            <Icon name="chat" size={14} />
                          </a>
                          <button formAction={markRemindedAction} name="leadId" value={r.id} className="btn btn-ghost btn-sm" aria-label={`Mark ${r.fullName} as reminded`} title="Mark as reminded">
                            <Icon name="check" size={14} />
                          </button>
                        </span>
                      ) : (
                        <span className="text-xs text-muted">{r.phone ? "" : "no number"}</span>
                      )}
                    </td>
                    <td>
                      {canWrite ? (
                        <select name={`att-${r.id}`} defaultValue={r.attended === null ? "" : r.attended ? "yes" : "no"} className="input input-sm" aria-label={`Did ${r.fullName} come?`}>
                          <option value="">Not marked</option>
                          <option value="yes">Came</option>
                          <option value="no">Did not come</option>
                        </select>
                      ) : (
                        <span className="text-sm">{r.attended === null ? "—" : r.attended ? "Came" : "Did not come"}</span>
                      )}
                    </td>
                    <td className="text-xs">
                      {r.enrolled ? <span className="chip chip-ok">enrolled</span> : r.consultedAfter ? <span className="chip chip-brand">held a consult</span> : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canWrite && rows.length > 0 && <button className="btn btn-primary btn-sm mt-3">Save attendance</button>}
      </form>
    </div>
  );
}
