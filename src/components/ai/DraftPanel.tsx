"use client";

import { useRef, useState, useTransition } from "react";
import { splitWeekly } from "@/lib/ai/split";
import { Icon } from "../ui/Icon";

type Result = { ok: true; text: string } | { ok: false; error: string };
type Choice = { name: string; label: string; options: [string, string][] };

/**
 * Ask Claude for a draft, then edit it here. Nothing is posted or sent: the person copies the text, or (for
 * the weekly review) puts it into the form and saves it themselves.
 */
export function DraftPanel({
  action,
  choices = [],
  button,
  fillForm,
  rows = 10,
}: {
  action: (f: FormData) => Promise<Result>;
  choices?: Choice[];
  button: string;
  fillForm?: string; // the weekly review form's id
  rows?: number;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [filled, setFilled] = useState(false);
  const [busy, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  const go = () =>
    start(async () => {
      setError("");
      setCopied(false);
      setFilled(false);
      const r = await action(new FormData(form.current!));
      if (r.ok) setText(r.text);
      else setError(r.error);
    });

  const fill = () => {
    const f = document.getElementById(fillForm!) as HTMLFormElement | null;
    if (!f) return;
    const parts = splitWeekly(text);
    for (const [k, val] of Object.entries(parts)) {
      const el = f.elements.namedItem(k) as HTMLTextAreaElement | null;
      if (el && val) el.value = val;
    }
    setFilled(true);
    f.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="grid gap-4">
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        {choices.map((c) => (
          <label key={c.name} className="field">
            {c.label}
            <select name={c.name} className="input w-auto" defaultValue={c.options[0][0]}>
              {c.options.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button className="btn btn-secondary" disabled={busy}>
          <Icon name="sparkle" />
          {busy ? "Writing…" : text ? "Write another" : button}
        </button>
      </form>
      {busy && (
        <p role="status" className="flex items-center gap-3 text-sm text-muted">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" aria-hidden />
          Claude is writing a draft…
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          <Icon name="alert" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {text && (
        <div className="grid gap-3">
          <label className="field">
            Draft (edit it before using it)
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={rows} dir="auto" className="input leading-relaxed" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                navigator.clipboard?.writeText(text);
                setCopied(true);
              }}
            >
              <Icon name="copy" size={14} />
              {copied ? "Copied" : "Copy"}
            </button>
            {fillForm && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={fill}>
                <Icon name="edit" size={14} />
                {filled ? "Put in the form: check it, then save" : "Put it in the review form"}
              </button>
            )}
          </div>
          <p className="text-xs text-muted">A draft by Claude: check every fact, price and date before it goes anywhere. Square brackets mark what it did not know.</p>
        </div>
      )}
    </div>
  );
}
