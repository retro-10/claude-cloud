"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitFormAction, type FormState } from "./actions";

type Config = { slug: string; askEmail: boolean; askCity: boolean; askSegment: boolean; askTier: boolean; thankYou: string | null };

function Send() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary mt-2 h-11 text-[15px]">
      {pending ? "Sending… · جارٍ الإرسال" : "Send · إرسال"}
    </button>
  );
}

const Label = ({ en, ar }: { en: string; ar: string }) => (
  <span className="flex justify-between gap-2">
    <span>{en}</span>
    <span dir="rtl" lang="ar">
      {ar}
    </span>
  </span>
);

/** The public sign-up form. Hidden fields carry the anti-spam stamp and the link's tracking tags. */
export function PublicForm({ c, stamp, hidden }: { c: Config; stamp: string; hidden: Record<string, string> }) {
  const [state, action] = useActionState<FormState, FormData>(submitFormAction, {});
  if (state.done)
    return (
      <div role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-5 text-sm">
        <p className="font-medium" dir="auto">
          {c.thankYou || "Thank you! We will message you on WhatsApp soon."}
        </p>
        {!c.thankYou && (
          <p className="mt-1" dir="rtl" lang="ar">
            شكرًا لك! سنتواصل معك على واتساب قريبًا.
          </p>
        )}
      </div>
    );
  const bad = (f: FormState["field"]) => (state.field === f ? true : undefined);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate={false}>
      <input type="hidden" name="slug" value={c.slug} />
      <input type="hidden" name="t" value={stamp} />
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {/* the honeypot: hidden from people and screen readers, filled in by bots */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="field">
        <Label en="Full name" ar="الاسم بالكامل" />
        <input name="name" required maxLength={120} autoComplete="name" dir="auto" aria-invalid={bad("name")} className="input h-11" />
      </label>
      <label className="field">
        <Label en="WhatsApp number" ar="رقم الواتساب" />
        <input name="phone" required type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="01x xxxx xxxx" aria-invalid={bad("phone")} className="input h-11" />
      </label>
      {c.askEmail && (
        <label className="field">
          <Label en="Email (optional)" ar="البريد الإلكتروني (اختياري)" />
          <input name="email" type="email" autoComplete="email" dir="ltr" aria-invalid={bad("email")} className="input h-11" />
        </label>
      )}
      {c.askCity && (
        <label className="field">
          <Label en="City" ar="المدينة" />
          <input name="city" maxLength={80} autoComplete="address-level2" dir="auto" className="input h-11" />
        </label>
      )}
      {c.askSegment && (
        <label className="field">
          <Label en="You are a…" ar="أنت…" />
          <select name="segment" defaultValue="" className="input h-11">
            <option value="">Choose · اختر</option>
            <option value="fresh_graduate">Fresh graduate · حديث التخرج</option>
            <option value="technician">Dental technician · فني أسنان</option>
            <option value="dentist">Dentist · طبيب أسنان</option>
            <option value="other">Other · أخرى</option>
          </select>
        </label>
      )}
      {c.askTier && (
        <label className="field">
          <Label en="Interested in" ar="مهتم بـ" />
          <select name="tier" defaultValue="unsure" className="input h-11">
            <option value="unsure">Not sure yet · لم أقرر بعد</option>
            <option value="foundation">Foundation</option>
            <option value="freelance_ready">Freelance Ready</option>
            <option value="production_partner">Production Partner</option>
          </select>
        </label>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" required className="mt-1" aria-invalid={bad("consent")} />
        <span>
          OrlaDent may message me on WhatsApp about the Camp.{" "}
          <span dir="rtl" lang="ar" className="block text-muted">
            أوافق على أن تتواصل معي أورلادنت على واتساب بخصوص الكامب.
          </span>
        </span>
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Send />
    </form>
  );
}
