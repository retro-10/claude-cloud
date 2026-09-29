import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { QuickAdd } from "@/components/QuickAdd";
import { SearchShortcut } from "@/components/SearchShortcut";
import { ThemeToggle } from "@/components/ThemeToggle";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { logout } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const src = await db.select().from(sources).orderBy(asc(sources.id));
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link href="/" className="font-semibold">
            OrlaDent Camp CRM
          </Link>
          <nav aria-label="Main" className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <Link href="/" className="hover:text-accent">
              Today
            </Link>
            <Link href="/leads" className="hover:text-accent">
              Leads
            </Link>
            <Link href="/pipeline" className="hover:text-accent">
              Pipeline
            </Link>
            <Link href="/cohorts" className="hover:text-accent">
              Cohorts
            </Link>
            <Link href="/dashboard" className="hover:text-accent">
              Dashboard
            </Link>
            {can(user.role, "settings:write") && (
              <Link href="/settings" className="hover:text-accent">
                Settings
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {can(user.role, "lead:write") && <QuickAdd sources={src} />}
            <ThemeToggle />
            <Link href="/account" className="hidden text-sm text-muted hover:text-fg sm:inline" title="My account">
              {user.name} · {user.role}
            </Link>
            <form action={logout}>
              <button className="text-sm text-muted hover:text-fg">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {!user.passwordChanged && (
        <div role="status" className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
          You are still using the initial password.{" "}
          <Link href="/account" className="underline">
            Set your own now
          </Link>
          .
        </div>
      )}
      <SearchShortcut />
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 outline-none has-[.board-wide]:max-w-none">
        {children}
      </main>
    </>
  );
}
