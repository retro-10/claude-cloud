"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Icon } from "../ui/Icon";

function Pending({ question }: { question: React.RefObject<HTMLTextAreaElement | null> }) {
  const { pending, data } = useFormStatus();
  if (!pending) return null;
  const q = String(data?.get("question") ?? question.current?.value ?? "");
  return (
    <div className="grid gap-4" aria-live="polite">
      {q && (
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-5 py-3.5 text-[0.9375rem] text-onbrand" dir="auto">
          {q}
        </div>
      )}
      <p role="status" className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-4 text-sm text-muted">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" aria-hidden />
        Looking it up in the app… this can take up to a minute.
      </p>
    </div>
  );
}

function Send() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" disabled={pending}>
      <Icon name="send" />
      {pending ? "Asking…" : "Ask"}
    </button>
  );
}

/** The question box. Enter asks; Shift+Enter starts a new line. */
export function AskForm({ action, threadId, disabled }: { action: (f: FormData) => Promise<void>; threadId?: number; disabled?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <form action={action} className="grid gap-4">
      <Pending question={ref} />
      {threadId ? <input type="hidden" name="threadId" value={threadId} /> : null}
      <div className="rounded-2xl border border-line bg-surface p-3 shadow-soft focus-within:border-brand/60">
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <textarea
          ref={ref}
          id="question"
          name="question"
          required
          rows={3}
          maxLength={2000}
          dir="auto"
          disabled={disabled}
          placeholder={threadId ? "Ask a follow-up…" : "Ask about leads, batches, campaigns, students or money…"}
          className="block w-full resize-none bg-transparent px-2 py-1.5 text-[0.9375rem] outline-none placeholder:text-faint"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (e.currentTarget.value.trim()) e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-2">
          <p className="text-xs text-muted">Read-only: it looks things up, it never changes or sends anything. Enter to ask, Shift+Enter for a new line.</p>
          <Send />
        </div>
      </div>
    </form>
  );
}

/** A suggested question: one click asks it. */
export function Suggestion({ action, text }: { action: (f: FormData) => Promise<void>; text: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="question" value={text} />
      <SuggestionButton text={text} />
    </form>
  );
}

function SuggestionButton({ text }: { text: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="flex h-full w-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left text-sm transition hover:border-brand/50 hover:bg-raised">
      <Icon name="sparkle" className="mt-0.5 shrink-0 text-accent" />
      <span>{pending ? "Asking…" : text}</span>
    </button>
  );
}
