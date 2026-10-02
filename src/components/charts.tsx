// Small, dependency-free charts rendered on the server. One hue (the brand accent) for a single series; a second
// series takes the validated slot 2 (orange; checked with the dataviz palette validator in both themes). Flat
// fills, 4px rounded data-ends, hairline axes; text always in text colours; every mark is focusable and shows its
// value on hover or keyboard focus, and every chart has a table view, so no value depends on hovering.

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);

function Tip({ value, label }: { value: string; label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs shadow-lift group-hover:block group-focus-visible:block"
    >
      <span className="num block font-semibold text-fg">{value}</span>
      <span className="block text-muted">{label}</span>
    </span>
  );
}

/** Horizontal bars from one baseline, value at the tip. For ranked lists and the funnel. */
export function BarList({
  rows,
  max,
  unit = "",
  aside,
}: {
  rows: { label: string; value: number; note?: string; muted?: boolean }[];
  max?: number;
  unit?: string;
  aside?: (r: { label: string; value: number; note?: string }) => React.ReactNode;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        const w = top ? Math.max(r.value ? 1.5 : 0, (r.value / top) * 100) : 0;
        return (
          <li key={r.label} className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-4 text-sm">
            <span dir="auto" className="truncate text-fg/90" title={r.label}>
              {r.label}
            </span>
            <span className="relative h-6">
              <span
                tabIndex={0}
                role="img"
                aria-label={`${r.label}: ${fmt(r.value)}${unit}`}
                className="group absolute inset-y-1.5 left-0 block rounded-r-[4px] outline-none"
                style={{ width: `${w}%`, minWidth: r.value ? 4 : 0 }}
              >
                <span className={`block h-full rounded-r-[4px] transition group-hover:brightness-110 ${r.muted ? "bg-muted/50" : "bg-brand"}`} />
                <Tip value={`${fmt(r.value)}${unit}`} label={r.note ? `${r.label} · ${r.note}` : r.label} />
              </span>
            </span>
            <span className="num min-w-[3.5rem] text-right text-sm">
              <span className="font-semibold">{fmt(r.value)}</span>
              {unit && <span className="text-xs text-muted">{unit}</span>}
              {aside && <span className="ml-2 text-xs text-muted">{aside(r)}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** One small column chart of a single series over weeks. Used as small multiples (never two scales on one chart). */
export function Columns({ title, data, total }: { title: string; data: { x: string; label: string; v: number }[]; total?: number }) {
  const max = Math.max(1, ...data.map((d) => d.v));
  const tick = max <= 4 ? max : Math.ceil(max / 2) * 2;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-medium">{title}</span>
        {total !== undefined && <span className="num text-xs text-muted">{fmt(total)} total</span>}
      </figcaption>
      <div className="relative h-32">
        <div aria-hidden className="num absolute inset-x-0 top-0 flex items-center gap-2 text-[10px] text-muted">
          <span className="w-5 text-right">{tick}</span>
          <span className="h-px flex-1 bg-line/70" />
        </div>
        <div aria-hidden className="num absolute inset-x-0 bottom-0 flex items-center gap-2 text-[10px] text-muted">
          <span className="w-5 text-right">0</span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="absolute bottom-0 left-7 right-0 top-0 flex items-end justify-around gap-[2px]">
          {data.map((d) => (
            <span
              key={d.x}
              tabIndex={0}
              role="img"
              aria-label={`${d.label}: ${d.v}`}
              className="group relative flex h-full flex-1 items-end justify-center outline-none"
            >
              <span
                className="block w-full max-w-[24px] rounded-t-[4px] bg-brand transition group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-brand/60"
                style={{ height: `${(d.v / tick) * 100}%`, minHeight: d.v ? 3 : 0 }}
              />
              <Tip value={String(d.v)} label={d.label} />
            </span>
          ))}
        </div>
      </div>
      <div aria-hidden className="ml-7 mt-1.5 flex justify-between text-[10px] text-muted">
        <span>{data[0]?.x}</span>
        <span>{data[data.length - 1]?.x}</span>
      </div>
    </figure>
  );
}

/** Two-part split (e.g. explicit no vs no decision): one bar, the 2px surface gap between parts. */
export function Split({ a, b }: { a: { label: string; value: number }; b: { label: string; value: number } }) {
  const total = a.value + b.value;
  if (!total) return <p className="text-sm text-muted">No lost leads in this selection.</p>;
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {a.value > 0 && <span className="bg-brand" style={{ width: `${(a.value / total) * 100}%` }} />}
        {b.value > 0 && <span className="bg-series2" style={{ width: `${(b.value / total) * 100}%` }} />}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-brand" />
          {a.label} <span className="num font-semibold">{a.value}</span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-series2" />
          {b.label} <span className="num font-semibold">{b.value}</span>
        </li>
      </ul>
    </div>
  );
}

/**
 * Two series of the same unit on one shared axis (e.g. income and costs per month): grouped columns,
 * the brand for the first series and slot 2 for the second, a legend, and hover / focus values.
 */
export function PairColumns({
  data,
  a,
  b,
  unit = "",
}: {
  data: { x: string; label: string; a: number; b: number }[];
  a: string;
  b: string;
  unit?: string;
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const nice = (() => {
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / p) * p;
  })();
  const short = (n: number) => (n >= 1000 ? `${fmt(Math.round(n / 1000))}k` : fmt(n));
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-brand" /> {a}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-series2" /> {b}
        </span>
      </figcaption>
      <div className="relative h-44">
        {[1, 0.5, 0].map((f) => (
          <div key={f} aria-hidden className="num absolute inset-x-0 flex items-center gap-2 text-[10px] text-muted" style={{ top: `${(1 - f) * 100}%`, transform: "translateY(-50%)" }}>
            <span className="w-8 text-right">{short(nice * f)}</span>
            <span className={`h-px flex-1 ${f === 0 ? "bg-line" : "bg-line/50"}`} />
          </div>
        ))}
        <div className="absolute bottom-0 left-10 right-0 top-0 flex items-end justify-around gap-1">
          {data.map((d) => (
            <span key={d.x} tabIndex={0} role="img" aria-label={`${d.label}: ${a} ${fmt(d.a)}${unit}, ${b} ${fmt(d.b)}${unit}`} className="group relative flex h-full flex-1 items-end justify-center gap-[2px] outline-none">
              <span className="block w-full max-w-[14px] rounded-t-[4px] bg-brand transition group-hover:brightness-110" style={{ height: `${(d.a / nice) * 100}%`, minHeight: d.a ? 3 : 0 }} />
              <span className="block w-full max-w-[14px] rounded-t-[4px] bg-series2 transition group-hover:brightness-110" style={{ height: `${(d.b / nice) * 100}%`, minHeight: d.b ? 3 : 0 }} />
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs shadow-lift group-hover:block group-focus-visible:block"
              >
                <span className="block text-muted">{d.label}</span>
                <span className="num block">
                  <span className="font-semibold text-fg">{fmt(d.a)}</span> {a.toLowerCase()}
                </span>
                <span className="num block">
                  <span className="font-semibold text-fg">{fmt(d.b)}</span> {b.toLowerCase()}
                </span>
              </span>
            </span>
          ))}
        </div>
      </div>
      <div aria-hidden className="ml-10 mt-1.5 flex justify-around text-[10px] text-muted">
        {data.map((d) => (
          <span key={d.x}>{d.x}</span>
        ))}
      </div>
    </figure>
  );
}
