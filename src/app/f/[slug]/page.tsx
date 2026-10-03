import { notFound } from "next/navigation";
import { db } from "@/db";
import { activeForm, cleanAttribution, formStamp } from "@/lib/lead-forms";
import { PublicForm } from "./form";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const f = await activeForm(db, (await props.params).slug);
  return { title: f ? `${f.title} · OrlaDent Camp` : "OrlaDent Camp", robots: { index: false } };
}

// A public sign-up page. The link's utm_* tags (and ?ref=) ride along as hidden fields onto the lead.
export default async function FormPage(props: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, sp] = await Promise.all([props.params, props.searchParams]);
  const f = await activeForm(db, params.slug);
  if (!f) notFound();
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return (
    <main id="main" className="flex min-h-screen items-start justify-center px-5 py-10 sm:items-center">
      <div className="w-full max-w-md animate-rise-in">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-brand/50 bg-gradient-to-br from-brand/40 to-surface font-display text-[9px] font-bold leading-[1.05] tracking-[0.12em] shadow-glow">
            <span>
              ORLA
              <br />
              DENT
              <br />
              <span className="text-accent">CAMP</span>
            </span>
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted">OrlaDent Camp</span>
        </div>
        <h1 className="page-title mb-2" dir="auto">
          {f.title}
        </h1>
        {f.intro && (
          <p className="mb-6 whitespace-pre-line text-sm text-muted" dir="auto">
            {f.intro}
          </p>
        )}
        <div className="card p-5">
          <PublicForm
            c={{ slug: f.slug, askEmail: f.askEmail, askCity: f.askCity, askSegment: f.askSegment, askTier: f.askTier, thankYou: f.thankYou }}
            stamp={formStamp(f.id)}
            hidden={cleanAttribution(flat)}
          />
        </div>
        <p className="mt-4 text-center text-xs text-muted">Your details are used only to contact you about OrlaDent Camp.</p>
      </div>
    </main>
  );
}
