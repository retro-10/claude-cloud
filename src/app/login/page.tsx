import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server-auth";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  // A cookie that is really valid (user active, password unchanged) skips the form.
  if (await getCurrentUser()) redirect("/");
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section aria-hidden className="relative hidden overflow-hidden border-r border-line bg-[#0b0b0a] lg:block">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-gold/15 blur-[120px]" />
        <div className="absolute -bottom-48 right-[-10rem] h-[30rem] w-[30rem] rounded-full bg-gold/10 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(rgb(201 162 39) 1px, transparent 1px), linear-gradient(90deg, rgb(201 162 39) 1px, transparent 1px)", backgroundSize: "64px 64px", maskImage: "radial-gradient(ellipse at 30% 40%, black, transparent 70%)" }}
        />
        <div className="relative flex h-full flex-col justify-between p-12 text-[#eeebe4]">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-gold/50 bg-gradient-to-br from-[#2a2415] to-[#0c0c0b] font-display text-2xl font-semibold text-gold shadow-glow">O</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#a09b92]">OrlaDent Camp</span>
          </div>
          <div className="max-w-md">
            <p className="font-display text-5xl font-semibold leading-[1.05] tracking-tight">
              Every lead,
              <br />
              <span className="bg-gradient-to-r from-gold-soft via-gold to-gold-deep bg-clip-text text-transparent">a dated next step.</span>
            </p>
            <p className="mt-6 text-base leading-relaxed text-[#a09b92]">
              Reply in minutes, move deals when the buyer moves, and see honestly what is working. Built for the way Camp sells: WhatsApp first, one
              conversation at a time.
            </p>
          </div>
          <div className="flex gap-8 text-xs text-[#a09b92]">
            <span>Speed to lead</span>
            <span>Earned stages</span>
            <span>Honest deadlines</span>
          </div>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-rise-in">
          <div className="mb-8 lg:hidden">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-gold/50 bg-gradient-to-br from-[#2a2415] to-[#0c0c0b] font-display text-2xl font-semibold text-gold">O</span>
          </div>
          <div className="eyebrow mb-2">Welcome back</div>
          <h1 className="page-title mb-2">OrlaDent Camp CRM</h1>
          <p className="mb-8 text-sm text-muted">Sign in to continue.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
