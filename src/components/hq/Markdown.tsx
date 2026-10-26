import Link from "next/link";
import { Icon } from "../ui/Icon";
import { Fragment } from "react";

// A small Markdown renderer for docs: headings, paragraphs, bullet and numbered lists, checklists, quotes, code,
// rules, **bold**, *italic*, `code` and [links](...). It builds React elements, never raw HTML, so a doc cannot
// inject markup or scripts. Links only go to http(s), mailto or a path inside the app.

const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?![/\\]))/i;

function inline(text: string, key = "i"): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-raised px-1.5 py-0.5 font-mono text-[0.9em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      if (!SAFE_HREF.test(href)) out.push(label);
      else if (href.startsWith("/"))
        out.push(
          <Link key={k} href={href} className="text-accent underline underline-offset-2">
            {label}
          </Link>,
        );
      else
        out.push(
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
            {label}
          </a>,
        );
    } else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: { text: string; check?: boolean }[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "hr" };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ kind: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push({ kind: "hr" });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: { text: string; check?: boolean }[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        const t = lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, "");
        const c = /^\[( |x|X)\]\s+(.*)$/.exec(t);
        items.push(c ? { text: c[2], check: c[1] !== " " } : { text: t });
        i++;
      }
      out.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ kind: "quote", text: body.join(" ") });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|>|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i])) body.push(lines[i++].trim());
    out.push({ kind: "p", text: body.join(" ") });
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  if (!blocks.length) return <p className="text-sm text-muted">This page is empty.</p>;
  return (
    <div className="flex flex-col gap-4 text-[15px] leading-7">
      {blocks.map((b, i) => {
        const k = String(i);
        switch (b.kind) {
          case "h":
            return b.level === 1 ? (
              <h2 key={k} className="mt-4 text-2xl font-semibold tracking-tight">{inline(b.text, k)}</h2>
            ) : b.level === 2 ? (
              <h3 key={k} className="mt-3 text-xl font-semibold tracking-tight">{inline(b.text, k)}</h3>
            ) : (
              <h4 key={k} className="mt-2 text-base font-semibold">{inline(b.text, k)}</h4>
            );
          case "p":
            return <p key={k}>{inline(b.text, k)}</p>;
          case "quote":
            return (
              <blockquote key={k} className="border-l-2 border-brand/60 pl-4 text-muted">
                {inline(b.text, k)}
              </blockquote>
            );
          case "code":
            return (
              <pre key={k} className="overflow-x-auto rounded-xl border border-line bg-raised p-4 font-mono text-sm leading-6">
                {b.text}
              </pre>
            );
          case "hr":
            return <hr key={k} className="border-line" />;
          default: {
            const Tag = b.kind;
            return (
              <Tag key={k} className={`flex flex-col gap-1.5 pl-6 ${b.kind === "ol" ? "list-decimal" : b.items.some((x) => x.check !== undefined) ? "list-none pl-1" : "list-disc"}`}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    {it.check === undefined ? (
                      inline(it.text, `${k}-${j}`)
                    ) : (
                      <Fragment>
                        <span aria-hidden className={`mr-2 inline-grid h-4 w-4 place-items-center rounded border align-[-2px] ${it.check ? "border-ok bg-ok/20 text-ok" : "border-muted"}`}>
                          {it.check && <Icon name="check" size={11} />}
                        </span>
                        <span className="sr-only">{it.check ? "Done: " : "To do: "}</span>
                        <span className={it.check ? "text-muted line-through" : ""}>{inline(it.text, `${k}-${j}`)}</span>
                      </Fragment>
                    )}
                  </li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
