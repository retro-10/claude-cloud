import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { AppFrame, type NavItem } from "@/components/shell/AppFrame";
import type { GoKey } from "@/components/shell/Shortcuts";
import { Icon, type IconName } from "@/components/ui/Icon";
import { getSetting } from "@/lib/app-settings";
import { clockState } from "@/lib/calendar";
import { waitingCount } from "@/lib/approvals";
import { unreadTotal } from "@/lib/chat";
import { listSpaces } from "@/lib/hq";
import { navCounts } from "@/lib/nav-counts";
import { notificationHref, recentNotifications } from "@/lib/notifications";
import { VIEWS, VIEW_ORDER } from "@/lib/views";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { taskCounts } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Designers have no lead list and no HQ: their app is the production studio. Marketing has HQ and Growth, but no
  // lead records. Only fetch what the person's sidebar shows.
  const sales = can(user.role, "lead:read");
  const hq = can(user.role, "hq:read");
  const [src, counts, notes, myTasks, spaces, clock, chatUnread, auxCodes, approvalsWaiting] = await Promise.all([
    sales ? db.select().from(sources).orderBy(asc(sources.id)) : [],
    sales ? navCounts(db) : null,
    recentNotifications(db, user.id),
    hq ? taskCounts(db, user.id) : null,
    hq ? listSpaces(db) : [],
    clockState(db, user.id),
    unreadTotal(db, user.id),
    getSetting(db, "auxCodes"),
    waitingCount(db, user.id),
  ]);
  // people who see the money get a standing reminder until two-factor is on
  const nudge2fa = user.passwordChanged && !user.twoFactor && can(user.role, "finance:read");

  const studio: NavItem = { href: "/production", label: "Production", icon: "layers", section: "Studio", keys: "G R" };
  const calendar: NavItem = { href: "/calendar", label: "Team calendar", icon: "calendar", section: "HQ", keys: "G Y" };
  const chat: NavItem = { href: "/chat", label: "Chat", icon: "chat", section: "HQ", count: chatUnread, keys: "G J" };
  const approvals: NavItem = { href: "/approvals", label: "Approvals", icon: "check", section: "HQ", count: approvalsWaiting, alert: approvalsWaiting > 0 };
  const nav: NavItem[] = !hq || !myTasks
    ? [studio, { ...chat, section: "Studio" }, { ...calendar, section: "Studio" }, { ...approvals, section: "Studio" }]
    : [
        { href: "/hq", label: "Home", icon: "today", section: "HQ", keys: "G H" },
        { href: "/inbox", label: "Inbox", icon: "inbox", section: "HQ", count: notes.unread, keys: "G I" },
        chat,
        approvals,
        calendar,
        { href: "/docs", label: "Docs", icon: "note", section: "HQ" },
        ...spaces.map((s): NavItem => ({ href: `/spaces/${s.id}`, label: s.name, icon: "layers", color: s.color, section: "Spaces", count: s.open })),
        sales && { href: "/command", label: "Command centre", icon: "gauge", section: "OrlaDent OS", keys: "G O" },
        can(user.role, "ai:use") && { href: "/ask", label: "Ask OrlaDent", icon: "chat", section: "OrlaDent OS", keys: "G A" },
        sales && { href: "/tools", label: "Tools", icon: "sparkle", section: "OrlaDent OS" },
        { href: "/team", label: "Team & ops", icon: "user", section: "OrlaDent OS" },
        counts && { href: "/", label: "Today", icon: "today", section: "Work", count: counts.today, alert: counts.overdue > 0, keys: "G T", exact: true },
        sales && { href: "/leads", label: "Leads", icon: "leads", section: "Work", keys: "G L" },
        sales && { href: "/pipeline", label: "Pipeline", icon: "pipeline", section: "Work", keys: "G P" },
        { href: "/tasks", label: "Tasks", icon: "list", section: "Work", count: myTasks.mine, alert: myTasks.mineOverdue > 0, keys: "G K" },
        ...(can(user.role, "growth:read")
          ? ([
              { href: "/growth/campaigns", label: "Campaigns", icon: "target", section: "Growth", keys: "G M" },
              { href: "/growth/content", label: "Content", icon: "sparkle", section: "Growth" },
              { href: "/growth/events", label: "Masterclasses", icon: "calendar", section: "Growth" },
              { href: "/growth/forms", label: "Lead forms", icon: "send", section: "Growth" },
              { href: "/growth/referrals", label: "Referrals", icon: "user", section: "Growth" },
            ] satisfies NavItem[])
          : []),
        ...(sales
          ? ([
              { href: "/cohorts", label: "Batches", icon: "cohorts", section: "Programme", keys: "G C" },
              { href: "/classes", label: "Classes", icon: "calendar", section: "Programme" },
              { href: "/assignments", label: "Assignments", icon: "list", section: "Programme" },
              { href: "/alumni", label: "Alumni", icon: "user", section: "Programme" },
              { href: "/proof", label: "Proof bank", icon: "sparkle", section: "Programme" },
            ] satisfies NavItem[])
          : []),
        can(user.role, "production:read") && studio,
        sales && { href: "/dashboard", label: "Dashboard", icon: "dashboard", section: "Insight", keys: "G D" },
        can(user.role, "finance:read") && { href: "/finance", label: "Finance", icon: "trend", section: "Insight", keys: "G F" },
        // smart views with live counts; the ones that are warnings use the attention colour
        ...(counts
          ? VIEW_ORDER.map((k): NavItem => ({
              href: `/leads?view=${k}`, label: VIEWS[k].label, icon: VIEWS[k].icon, section: "Views",
              count: counts.views[k], alert: ["no_next_step", "neglected"].includes(k) && counts.views[k] > 0,
            }))
          : []),
        can(user.role, "settings:write") && { href: "/settings", label: "Settings", icon: "settings", section: "Admin", keys: "G S" },
      ].filter((n): n is NavItem => !!n);

  // things to do from ⌘K, by permission
  const actions = [
    { href: "/approvals/new?type=expense", label: "New expense", icon: "trend", keywords: "spend money receipt reimburse approval" },
    { href: "/approvals/new?type=leave", label: "Ask for leave", icon: "calendar", keywords: "day off holiday vacation approval" },
    { href: "/approvals/new?type=purchase", label: "Ask to buy something", icon: "plus", keywords: "purchase order approval" },
    { href: "/approvals/new?type=brand", label: "Brand or design request", icon: "sparkle", keywords: "design asset post approval" },
    can(user.role, "chat:write") && { href: "/chat/new", label: "New message", icon: "chat", keywords: "chat dm direct" },
    hq && can(user.role, "task:write") && { href: "/docs/new", label: "New doc", icon: "note", keywords: "page wiki write" },
  ].filter((a): a is { href: string; label: string; icon: IconName; keywords: string } => !!a);

  const goKeys: GoKey[] = nav.filter((n) => n.keys).map((n) => ({ key: n.keys!.slice(-1).toLowerCase(), href: n.href, label: n.label }));

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:font-medium focus:text-onbrand">
        Skip to content
      </a>
      <AppFrame user={{ name: user.name, role: user.role }} nav={nav} canWrite={can(user.role, "lead:write")} sources={src}
        goKeys={goKeys}
        actions={actions}
        clock={{
          running: clock.running,
          since: clock.since?.toISOString() ?? null,
          aux: clock.aux && { label: clock.aux.label, since: clock.aux.since.toISOString() },
          codes: auxCodes.map((c) => ({ key: c.key, label: c.label })),
        }}
        bell={{ unread: notes.unread, items: notes.items.map((n) => ({ id: n.id, title: n.title, href: notificationHref(n), at: n.createdAt.toISOString(), unread: !n.readAt })) }}
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
        {nudge2fa && (
          <div role="status" className="border-b border-line bg-raised/60 px-4 py-2 text-center text-sm text-muted">
            <Icon name="shield" size={14} className="-mt-0.5 mr-1.5 inline" />
            You can see the money: protect your account with two-factor sign-in.{" "}
            <Link href="/account#two-factor" className="font-medium text-fg underline underline-offset-2">
              Set it up (2 minutes)
            </Link>
          </div>
        )}
        <main id="main" tabIndex={-1} className="shell-container min-w-0 overflow-x-clip pb-28 pt-8 outline-none has-[.board-wide]:max-w-none sm:pb-16 lg:pt-10">
          {children}
        </main>
      </AppFrame>
    </>
  );
}
