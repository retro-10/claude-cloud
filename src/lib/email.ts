import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { notifications, users } from "@/db/schema";
import { notificationHref } from "./notifications";

// Email, through Resend's API (no SDK). Off until RESEND_API_KEY is set; the sender is EMAIL_FROM (an address on a
// domain verified in Resend). The app never emails leads from here: only staff, about their own notifications.

const ENDPOINT = "https://api.resend.com/emails";
const FROM = () => process.env.EMAIL_FROM?.trim() || "OrlaDent HQ <hq@orladent.com>";

export const emailOn = () => !!process.env.RESEND_API_KEY?.trim();

export async function sendEmail(msg: { to: string; subject: string; text: string; html: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: "Email is off (no RESEND_API_KEY)" };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM(), to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, error: `Resend: ${j.message ?? res.status}` };
  } catch {
    return { ok: false, error: "Resend could not be reached" };
  }
}

/** The kinds that count as important: they ask something of the person, or answer something they asked. */
export const IMPORTANT_KINDS = ["approval_request", "approval_question", "approval_approved", "approval_rejected", "chat_mention", "chat_dm", "clock_auto_stopped", "announcement"];
export const EMAIL_CHOICES = [
  { key: "important", label: "Important only", hint: "approvals, questions and answers, mentions, direct messages, must-read announcements" },
  { key: "all", label: "Everything", hint: "also new leads routed to you, rules and reminders" },
  { key: "none", label: "None", hint: "the bell and the Inbox only" },
] as const;

const WAIT_MS = 10 * 60_000; // a notification read in the app within 10 minutes is never emailed
const MAX_AGE_MS = 2 * 86_400_000;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let running = false;

/**
 * Emails each person one digest of their notifications still unread after 10 minutes, by their email setting.
 * Every notification is looked at once: it is marked emailed whether it went out, was not wanted, or email is off.
 */
export async function sendNotificationEmails(db: Db, now = new Date()): Promise<{ emails: number; items: number }> {
  if (running) return { emails: 0, items: 0 };
  running = true;
  try {
    const rows = await db
      .select({ n: notifications, email: users.email, name: users.name, pref: users.emailNotifications, active: users.active })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .where(and(isNull(notifications.emailedAt), isNull(notifications.readAt), lt(notifications.createdAt, new Date(now.getTime() - WAIT_MS)), gte(notifications.createdAt, new Date(now.getTime() - MAX_AGE_MS))))
      .orderBy(asc(notifications.createdAt))
      .limit(500);
    if (!rows.length) return { emails: 0, items: 0 };
    const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
    const byUser = new Map<number, typeof rows>();
    for (const r of rows) byUser.set(r.n.userId, [...(byUser.get(r.n.userId) ?? []), r]);
    let emails = 0;
    let items = 0;
    for (const list of byUser.values()) {
      const { email, name, pref, active } = list[0];
      const wanted = !active || pref === "none" || !emailOn() ? [] : list.filter((r) => pref === "all" || IMPORTANT_KINDS.includes(r.n.kind));
      if (wanted.length) {
        const line = (r: (typeof rows)[number]) => {
          const href = notificationHref(r.n);
          return { text: `• ${r.n.title}${href && base ? `\n  ${base}${href}` : ""}`, html: `<li>${href && base ? `<a href="${esc(base + href)}">${esc(r.n.title)}</a>` : esc(r.n.title)}</li>` };
        };
        const lines = wanted.map(line);
        const subject = wanted.length === 1 ? wanted[0].n.title.slice(0, 120) : `${wanted.length} things waiting for you in HQ`;
        const first = name.split(/\s+/)[0];
        const footer = `You get these because they were still unread after 10 minutes. Change it in My account${base ? ` (${base}/account)` : ""}.`;
        const r = await sendEmail({
          to: email,
          subject,
          text: `Hi ${first},\n\n${lines.map((l) => l.text).join("\n")}\n\n${footer}`,
          html: `<p>Hi ${esc(first)},</p><ul>${lines.map((l) => l.html).join("")}</ul><p style="color:#666;font-size:12px">${esc(footer)}</p>`,
        });
        if (!r.ok) continue; // leave them for the next run (transient failure); they age out after two days
        emails++;
        items += wanted.length;
      }
      await db
        .update(notifications)
        .set({ emailedAt: now })
        .where(inArray(notifications.id, list.map((r) => r.n.id)));
    }
    return { emails, items };
  } finally {
    running = false;
  }
}
