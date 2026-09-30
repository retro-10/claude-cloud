import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { AppFrame, type NavItem } from "@/components/shell/AppFrame";
import type { GoKey } from "@/components/shell/Shortcuts";
import { Icon } from "@/components/ui/Icon";
import { navCounts } from "@/lib/nav-counts";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [src, counts] = await Promise.all([db.select().from(sources).orderBy(asc(sources.id)), navCounts(db)]);

  const nav: NavItem[] = [
    { href: "/", label: "Today", icon: "today", section: "Work", count: counts.today, alert: counts.overdue > 0, keys: "G T", exact: true },
    { href: "/leads", label: "Leads", icon: "leads", section: "Work", keys: "G L" },
    { href: "/pipeline", label: "Pipeline", icon: "pipeline", section: "Work", keys: "G P" },
    { href: "/cohorts", label: "Cohorts", icon: "cohorts", section: "Programme", keys: "G C" },
    { href: "/dashboard", label: "Dashboard", icon: "dashboard", section: "Insight", keys: "G D" },
  ];
  if (can(user.role, "settings:write")) nav.push({ href: "/settings", label: "Settings", icon: "settings", section: "Admin", keys: "G S" });

  const goKeys: GoKey[] = nav.filter((n) => n.keys).map((n) => ({ key: n.keys!.slice(-1).toLowerCase(), href: n.href, label: n.label }));

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-gold focus:px-3 focus:py-2 focus:font-medium focus:text-ink">
        Skip to content
      </a>
      <AppFrame user={{ name: user.name, role: user.role }} nav={nav} canWrite={can(user.role, "lead:write")} sources={src} goKeys={goKeys}>
        {!user.passwordChanged && (
          <div role="status" className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
            <Icon name="shield" size={14} className="-mt-0.5 mr-1.5 inline" />
            You are still using the initial password.{" "}
            <Link href="/account" className="font-medium underline underline-offset-2">
              Set your own now
            </Link>
            .
          </div>
        )}
        <main id="main" tabIndex={-1} className="mx-auto max-w-[1400px] px-4 pb-28 pt-6 outline-none sm:px-6 sm:pb-12 lg:pt-8">
          {children}
        </main>
      </AppFrame>
    </>
  );
}
