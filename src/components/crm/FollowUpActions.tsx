import { completeFollowUpAction, rescheduleFollowUpAction, setNextStepAction } from "@/app/(app)/followups/actions";
import { Icon } from "../ui/Icon";
import { Popover, menuItem } from "./Popover";

const QUICK = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "In a week" },
];

function Hidden({ id, leadId }: { id?: number; leadId: number }) {
  return (
    <>
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="leadId" value={leadId} />
    </>
  );
}

/** P6: "Done" always offers the next step in the same click, so no lead is left without one. */
export function DoneMenu({ id, leadId }: { id: number; leadId: number }) {
  return (
    <Popover label={<><Icon name="check" size={14} /> Done</>} title="Mark done and set the next step">
      <div className="eyebrow px-2.5 pb-1 pt-1.5">Done, next step…</div>
      {QUICK.map((q) => (
        <form key={q.days} action={completeFollowUpAction}>
          <Hidden id={id} leadId={leadId} />
          <input type="hidden" name="days" value={q.days} />
          <button className={menuItem}>
            <Icon name="calendar" size={14} className="text-muted" />
            {q.label}
          </button>
        </form>
      ))}
      <form action={completeFollowUpAction} className="flex items-center gap-1.5 px-1.5 py-1">
        <Hidden id={id} leadId={leadId} />
        <input type="date" name="date" required aria-label="Next step on" className="input input-sm flex-1" />
        <button className="btn btn-secondary btn-sm">Set</button>
      </form>
      <div className="my-1 h-px bg-line" />
      <form action={completeFollowUpAction}>
        <Hidden id={id} leadId={leadId} />
        <button className={`${menuItem} text-muted`}>Done, no next step</button>
      </form>
    </Popover>
  );
}

export function SnoozeMenu({ id, leadId }: { id: number; leadId: number }) {
  return (
    <Popover label={<Icon name="snooze" size={14} />} className="btn btn-ghost btn-sm w-7 px-0" title="Move to another day">
      <div className="eyebrow px-2.5 pb-1 pt-1.5">Move to…</div>
      {QUICK.map((q) => (
        <form key={q.days} action={rescheduleFollowUpAction}>
          <Hidden id={id} leadId={leadId} />
          <input type="hidden" name="days" value={q.days} />
          <button className={menuItem}>{q.label}</button>
        </form>
      ))}
      <form action={rescheduleFollowUpAction} className="flex items-center gap-1.5 px-1.5 py-1">
        <Hidden id={id} leadId={leadId} />
        <input type="date" name="date" required aria-label="Reschedule to" className="input input-sm flex-1" />
        <button className="btn btn-secondary btn-sm">Move</button>
      </form>
    </Popover>
  );
}

/** For leads with no open follow-up: give them one. */
export function NextStepMenu({ leadId }: { leadId: number }) {
  return (
    <Popover label={<><Icon name="flag" size={14} /> Set next step</>} className="btn btn-secondary btn-sm">
      {QUICK.map((q) => (
        <form key={q.days} action={setNextStepAction}>
          <Hidden leadId={leadId} />
          <input type="hidden" name="days" value={q.days} />
          <button className={menuItem}>{q.label}</button>
        </form>
      ))}
      <form action={setNextStepAction} className="flex items-center gap-1.5 px-1.5 py-1">
        <Hidden leadId={leadId} />
        <input type="date" name="date" required aria-label="Next step on" className="input input-sm flex-1" />
        <button className="btn btn-secondary btn-sm">Set</button>
      </form>
    </Popover>
  );
}
