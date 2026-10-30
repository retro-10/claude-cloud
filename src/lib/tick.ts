import type { Db } from "@/db";
import { remindUnacknowledged } from "./announcements";
import { moveFilesToDrive } from "./attachments";
import { backupIfDue } from "./backup";
import { stopForgottenClocks } from "./calendar";
import { sendNotificationEmails } from "./email";
import { notionConfig, syncNow } from "./notion/sync";
import { runScheduledRules } from "./workflows";

// One round of the background work. An always-on server runs it every 5 minutes from instrumentation.ts; on a
// host that only runs code for requests (Vercel), /api/cron/tick runs it when the scheduler calls. Each step is
// independent: one failing never stops the others.
export async function runTick(db: Db, opts: { backup: boolean; notion: boolean }) {
  const steps: Record<string, () => Promise<unknown>> = {
    // workflow rules with a time trigger (follow-up overdue, response time breached)
    rules: () => runScheduledRules(db),
    // clocks left running from an earlier day stop at the midnight after they started
    clocks: () => stopForgottenClocks(db),
    // with Google Drive connected, files still stored in the database move there (a few per tick)
    files: () => moveFilesToDrive(db),
    // an email digest of notifications left unread for 10 minutes (when RESEND_API_KEY is set)
    emails: () => sendNotificationEmails(db),
    // a daily reminder to whoever has not acknowledged a must-read announcement
    reminders: () => remindUnacknowledged(db),
  };
  // a database backup to Drive once a day (needs pg_dump: not on Vercel, where a GitHub Action takes it instead)
  if (opts.backup) steps.backup = () => backupIfDue(db);
  // the two-way Notion sync, when NOTION_TOKEN is set
  if (opts.notion && notionConfig()) steps.notion = () => syncNow(db) ?? Promise.resolve(null);
  const names = Object.keys(steps);
  const results = await Promise.allSettled(names.map((n) => steps[n]()));
  return Object.fromEntries(names.map((n, i) => [n, results[i].status === "fulfilled" ? "ok" : "failed"]));
}
