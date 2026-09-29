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
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link href="/" className="font-semibold">
            OrlaDent Camp CRM
          </Link>
          <nav className="flex gap-3 text-sm">
            <Link href="/" className="hover:text-gold">
              Today
            </Link>
            <Link href="/leads" className="hover:text-gold">
              Leads
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {can(user.role, "lead:write") && <QuickAdd sources={src} />}
            <ThemeToggle />
            <span className="hidden text-sm text-muted sm:inline">
              {user.name} · {user.role}
            </span>
            <form action={logout}>
              <button className="text-sm text-muted hover:text-fg">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <SearchShortcut />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
