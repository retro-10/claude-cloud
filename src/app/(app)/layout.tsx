import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { AppFrame, type NavItem } from "@/components/shell/AppFrame";
import type { GoKey } from "@/components/shell/Shortcuts";
import { Icon } from "@/components/ui/Icon";
import { navCounts } from "@/lib/nav-counts";
import { recentNotifications } from "@/lib/notifications";
import { VIEWS, VIEW_ORDER } from "@/lib/views";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { taskCounts } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [src, counts, notes, myTasks] = await Promise.all([
    db.select().from(sources).orderBy(asc(sources.id)),
    navCounts(db),
    recentNotifications(db, user.id),
    taskCounts(db, user.id),
  ]);

  const nav: NavItem[] = [
    { href: "/command", label: "Command centre", icon: "gauge", section: "OrlaDent OS", keys: "G O" },
    { href: "/", label: "Today", icon: "today", section: "Work", count: counts.today, alert: counts.overdue > 0, keys: "G T", exact: true },
    { href: "/leads", label: "Leads", icon: "leads", section: "Work", keys: "G L" },
    { href: "/pipeline", label: "Pipeline", icon: "pipeline", section: "Work", keys: "G P" },
    { href: "/tasks", label: "Tasks", icon: "list", section: "Work", count: myTasks.mine, alert: myTasks.mineOverdue > 0, keys: "G K" },
    { href: "/cohorts", label: "Batches", icon: "cohorts", section: "Programme", keys: "G C" },
    { href: "/proof", label: "Proof bank", icon: "sparkle", section: "Programme" },
    { href: "/dashboard", label: "Dashboard", icon: "dashboard", section: "Insight", keys: "G D" },
  ];
  if (can(user.role, "finance:read")) nav.push({ href: "/finance", label: "Finance", icon: "trend", section: "Insight", keys: "G F" });
  // V1: smart views with live counts; the ones that are warnings use the attention colour
  for (const k of VIEW_ORDER) {
    const v = VIEWS[k];
    nav.push({ href: `/leads?view=${k}`, label: v.label, icon: v.icon, section: "Views", count: counts.views[k], alert: ["no_next_step", "neglected"].includes(k) && counts.views[k] > 0 });
  }
  if (can(user.role, "settings:write")) nav.push({ href: "/settings", label: "Settings", icon: "settings", section: "Admin", keys: "G S" });

  const goKeys: GoKey[] = nav.filter((n) => n.keys).map((n) => ({ key: n.keys!.slice(-1).toLowerCase(), href: n.href, label: n.label }));

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:font-medium focus:text-onbrand">
        Skip to content
      </a>
      <AppFrame user={{ name: user.name, role: user.role }} nav={nav} canWrite={can(user.role, "lead:write")} sources={src}
        goKeys={goKeys}
        bell={{ unread: notes.unread, items: notes.items.map((n) => ({ id: n.id, title: n.title, leadId: n.leadId, at: n.createdAt.toISOString(), unread: !n.readAt })) }}
      >
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
        <main id="main" tabIndex={-1} className="mx-auto max-w-[1400px] px-4 pb-28 pt-6 outline-none has-[.board-wide]:max-w-none sm:px-6 sm:pb-12 lg:pt-8">
          {children}
        </main>
      </AppFrame>
    </>
  );
}
