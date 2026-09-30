import { formatMinutes, speedBadge } from "@/lib/speed";

const STYLE = {
  ok: "bg-ok/15 text-ok",
  amber: "bg-warn/20 text-warn",
  red: "bg-danger/20 text-danger",
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
