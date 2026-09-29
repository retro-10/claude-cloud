import { formatMinutes, speedBadge } from "@/lib/speed";

const STYLE = {
  ok: "bg-emerald-500/15 text-emerald-400",
  amber: "bg-amber-500/20 text-amber-400",
  red: "bg-red-500/20 text-red-400",
} as const;

// Server-rendered: shows minutes since creation as of page load, only while uncontacted.
export function SpeedBadge({ createdAt, firstContactAt }: { createdAt: Date; firstContactAt: Date | null }) {
  const b = speedBadge(createdAt, firstContactAt);
  if (!b) return null;
  return (
    <span
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STYLE[b.level]}`}
      title="Time since the lead arrived, not yet contacted"
    >
      {formatMinutes(b.minutes)} waiting
    </span>
  );
}
