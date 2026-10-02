import Link from "next/link";
import { Fragment } from "react";

/**
 * Renders the small slice of markdown the assistant writes: paragraphs, headings, bullet and numbered lists,
 * simple tables, **bold**, `code` and links. It never renders HTML, and links go only to pages inside the app
 * (paths starting with a single "/"); anything else shows as plain text.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      blocks.push(
        <p key={i} className="font-semibold text-fg">
          {inline(h[1])}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/).test(lines[i])) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/, ""));
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={i} className={`grid gap-1.5 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={i} className="overflow-x-auto rounded-xl border border-line">
          <table className="table">
            <thead>
              <tr>
                {head.map((c, k) => (
                  <th key={k} scope="col">
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, k) => (
                <tr key={k}>
                  {r.map((c, n) => (
                    <td key={n} className={/^[-\d,.%\s]+(EGP)?$/.test(c) ? "num" : undefined}>
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={i}>{para.map((p, k) => <Fragment key={k}>{k > 0 && <br />}{inline(p)}</Fragment>)}</p>);
  }
  return (
    <div dir="auto" className="grid gap-3 text-[0.9375rem] leading-relaxed">
      {blocks}
    </div>
  );
}

const TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;

export const safeHref = (h: string) => (/^\/(?!\/)[\w\-./?=&%#]*$/.test(h) ? h : null);

function inline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = m.index;
    if (m[1] !== undefined) {
      const href = safeHref(m[2]);
      out.push(
        href ? (
          <Link key={k} href={href} className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
            {m[1]}
          </Link>
        ) : (
          m[1]
        ),
      );
    } else if (m[3] !== undefined) out.push(<strong key={k} className="font-semibold text-fg">{m[3]}</strong>);
    else out.push(<code key={k} className="rounded bg-raised px-1.5 py-0.5 text-[0.85em]">{m[4]}</code>);
    last = k + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
