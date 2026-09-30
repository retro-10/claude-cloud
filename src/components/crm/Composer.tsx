"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { logSentMessageAction } from "@/app/(app)/leads/actions";
import { CATEGORIES, PLACEHOLDERS, renderTemplate, unfilled, whatsappPrefill, type TemplateContext } from "@/lib/templates-render";
import { Icon } from "../ui/Icon";

export const OPEN_COMPOSER = "crm:compose";

type Template = { id: number; name: string; category: string; language: "ar" | "en"; body: string };
type Data = {
  lead: { id: number; fullName: string; phone: string | null; doNotContact: boolean };
  templates: Template[];
  ctx: { ar: TemplateContext; en: TemplateContext };
  canWrite: boolean;
};

/** Opens the composer for a lead from anywhere (Today, board card, lead page). */
export function ComposeButton({
  leadId,
  phone,
  doNotContact,
  size = "sm",
  label = "WhatsApp",
}: {
  leadId: number;
  phone: string | null;
  doNotContact?: boolean;
  size?: "sm" | "md";
  label?: string;
}) {
  if (!phone) return null;
  if (doNotContact)
    return (
      <span className="chip chip-danger" title="Marked do-not-contact: sending is switched off">
        <Icon name="ban" size={12} /> Do not contact
      </span>
    );
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_COMPOSER, { detail: leadId }))}
      className={`btn btn-wa ${size === "sm" ? "btn-sm" : ""}`}
      title="Write a WhatsApp message from a template"
    >
      <Icon name="chat" size={size === "sm" ? 14 : 16} />
      {label}
    </button>
  );
}

/**
 * M1 + M2: choose a template, see it filled in from the lead and cohort, edit it, then open WhatsApp
 * with the text prefilled. Nothing is sent by the CRM: after opening WhatsApp the user confirms
 * "I sent it", which logs the message on the timeline (and counts the template's use).
 */
export function Composer() {
  const router = useRouter();
  const [leadId, setLeadId] = useState<number | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [tplId, setTplId] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [stage, setStage] = useState<"write" | "confirm" | "done">("write");
  const [busy, start] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setLeadId(null);
    setData(null);
    setError("");
    setStage("write");
    setTplId(null);
    setText("");
    restore.current?.focus?.();
  }, []);

  useEffect(() => {
    const open = (e: Event) => {
      restore.current = document.activeElement as HTMLElement | null;
      setLeadId((e as CustomEvent<number>).detail);
    };
    window.addEventListener(OPEN_COMPOSER, open);
    return () => window.removeEventListener(OPEN_COMPOSER, open);
  }, []);

  useEffect(() => {
    if (leadId === null) return;
    const ctrl = new AbortController();
    fetch(`/api/leads/${leadId}/compose`, { signal: ctrl.signal })
      .then(async (r) => (r.ok ? setData(await r.json()) : setError("Could not load this lead.")))
      .catch(() => {});
    return () => ctrl.abort();
  }, [leadId]);

  useEffect(() => {
    if (leadId === null) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [leadId, close]);

  const templates = useMemo(() => (data?.templates ?? []).filter((t) => t.language === lang), [data, lang]);
  const pick = (t: Template | null) => {
    setTplId(t?.id ?? null);
    setText(t && data ? renderTemplate(t.body, data.ctx[lang]).text : "");
    requestAnimationFrame(() => textRef.current?.focus());
  };

  if (leadId === null) return null;
  const missing = unfilled(text);
  const link = data ? whatsappPrefill(data.lead.phone, missing.length ? "" : text.trim()) : null;

  return (
    <div className="fixed inset-0 z-[58] flex items-start justify-center bg-black/55 p-3 pt-[6vh] backdrop-blur-[2px] animate-fade-in" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-pop-in"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-brand/40 bg-brand/10 text-accent">
            <Icon name="chat" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="composer-title" className="truncate font-display text-xl font-semibold leading-tight" dir="auto">
              {data ? `Message ${data.lead.fullName}` : "Message"}
            </h2>
            <p className="num text-xs text-muted" dir="ltr">
              {data?.lead.phone ?? " "}
            </p>
          </div>
          <button onClick={close} className="btn btn-ghost btn-icon" aria-label="Close">
            <Icon name="x" />
          </button>
        </div>

        {!data && !error && <div className="p-10 text-center text-sm text-muted">Loading…</div>}
        {error && <p role="alert" className="p-6 text-sm text-danger">{error}</p>}

        {data && stage === "write" && (
          <div className="grid min-h-0 flex-1 gap-0 overflow-hidden sm:grid-cols-[220px_1fr]">
            <div className="flex min-h-0 flex-col border-b border-line sm:border-b-0 sm:border-r">
              <div className="flex gap-1 p-2" role="tablist" aria-label="Language">
                {(["ar", "en"] as const).map((l) => (
                  <button
                    key={l}
                    role="tab"
                    aria-selected={lang === l}
                    onClick={() => {
                      setLang(l);
                      setTplId(null);
                      setText("");
                    }}
                    className={`btn btn-sm flex-1 ${lang === l ? "btn-secondary border-brand/50" : "btn-ghost"}`}
                  >
                    {l === "ar" ? "العربية" : "English"}
                  </button>
                ))}
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto p-2 pt-0 max-sm:max-h-40" aria-label="Templates">
                <li>
                  <button onClick={() => pick(null)} className={`w-full rounded-lg px-2.5 py-2 text-left text-sm ${tplId === null ? "bg-raised" : "hover:bg-raised/60"}`}>
                    <span className="block font-medium">Blank message</span>
                    <span className="block text-xs text-muted">Write your own</span>
                  </button>
                </li>
                {templates.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => pick(t)}
                      className={`w-full rounded-lg px-2.5 py-2 text-left text-sm ${tplId === t.id ? "bg-raised shadow-[inset_2px_0_0_rgb(var(--brand))]" : "hover:bg-raised/60"}`}
                    >
                      <span className="block font-medium">{t.name}</span>
                      <span className="block text-xs text-muted">{CATEGORIES[t.category] ?? t.category}</span>
                    </button>
                  </li>
                ))}
                {templates.length === 0 && <li className="px-2.5 py-2 text-xs text-muted">No templates in this language yet.</li>}
              </ul>
            </div>
            <div className="flex min-h-0 flex-col gap-3 p-4">
              <label className="field flex-1">
                Message
                <textarea
                  ref={textRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  dir="auto"
                  rows={8}
                  placeholder={lang === "ar" ? "اكتب رسالتك…" : "Type your message…"}
                  className="input min-h-[10rem] flex-1 resize-none text-[15px] leading-relaxed"
                />
              </label>
              {missing.length > 0 && (
                <div role="alert" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <Icon name="alert" size={14} /> Fill these in before sending:
                  </div>
                  <ul className="list-inside list-disc">
                    {missing.map((m) => (
                      <li key={m}>
                        <code className="font-semibold">{`{${m}}`}</code> {PLACEHOLDERS[m as keyof typeof PLACEHOLDERS] ?? "unknown placeholder"}: not set for this lead
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  className="btn btn-secondary"
                  disabled={!text.trim() || missing.length > 0}
                  onClick={() => navigator.clipboard?.writeText(text.trim())}
                  title="Copy the text"
                >
                  <Icon name="copy" size={14} /> Copy
                </button>
                <a
                  href={link ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!link || missing.length > 0}
                  onClick={(e) => {
                    if (!link || missing.length > 0) return e.preventDefault();
                    if (text.trim() && data.canWrite) setStage("confirm");
                  }}
                  className={`btn btn-primary ${!link || missing.length > 0 ? "pointer-events-none opacity-50" : ""}`}
                >
                  <Icon name="send" size={14} /> Open in WhatsApp
                </a>
              </div>
              <p className="text-[11px] text-muted">Nothing is sent from the CRM. WhatsApp opens with the text ready; you press send there.</p>
            </div>
          </div>
        )}

        {data && stage === "confirm" && (
          <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-brand/40 bg-brand/10 text-accent">
              <Icon name="send" size={20} />
            </span>
            <div>
              <p className="font-display text-xl font-semibold">Did you send it?</p>
              <p className="mt-1 text-sm text-muted">Logging it records the message on the timeline and counts as the first contact.</p>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={() => setStage("write")}>
                Not sent
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    const r = await logSentMessageAction({ leadId: data.lead.id, templateId: tplId, body: text.trim() });
                    if (!r.ok) return setError(r.error ?? "Could not log it");
                    setStage("done");
                    router.refresh();
                    setTimeout(close, 900);
                  })
                }
              >
                <Icon name="check" size={14} /> Yes, log it as sent
              </button>
            </div>
          </div>
        )}
        {data && stage === "done" && (
          <p role="status" className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-ok">
            <Icon name="check" /> Logged on the timeline.
          </p>
        )}
      </div>
    </div>
  );
}
