// Runs once when the server starts (Next.js instrumentation hook).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Next.js logs unhandled errors with console.error. A database error object carries query parameters
    // (lead names, phone numbers), so scrub every logged error. See src/lib/redact.ts.
    const { installLogScrubber } = await import("./lib/redact");
    installLogScrubber();

    // Workflow rules with a time trigger (follow-up overdue, response time breached) are swept every
    // 5 minutes. Skipped during the build and when no database is configured.
    if (process.env.DATABASE_URL && process.env.NEXT_PHASE !== "phase-production-build") {
      // Hosts that run `npm start` with no shell and no Docker entrypoint (Hostinger's Node.js apps) set
      // MIGRATE_ON_START=true: migrations and reference data are applied here, before the first request.
      if (process.env.MIGRATE_ON_START === "true") {
        const { runMigrations } = await import("./db/migrate");
        const { seedReference } = await import("./db/seed");
        await runMigrations();
        await seedReference();
      }
      const { db } = await import("./db");
      const { runScheduledRules } = await import("./lib/workflows");
      // the same tick stops clocks left running from an earlier day (at the midnight after they started)
      const { stopForgottenClocks } = await import("./lib/calendar");
      const { moveFilesToDrive } = await import("./lib/attachments");
      const { backupIfDue } = await import("./lib/backup");
      const { sendNotificationEmails } = await import("./lib/email");
      const tick = () => {
        void runScheduledRules(db).catch(() => 0);
        void stopForgottenClocks(db).catch(() => 0);
        // and, with Google Drive connected, moves files still stored in the database there (a few per tick)
        void moveFilesToDrive(db).catch(() => 0);
        // and a database backup to Drive once a day
        void backupIfDue(db).catch(() => 0);
        // and an email digest of notifications left unread for 10 minutes (when RESEND_API_KEY is set)
        void sendNotificationEmails(db).catch(() => 0);
      };
      setTimeout(tick, 30_000);
      setInterval(tick, 5 * 60_000).unref?.();

      // Two-way Notion sync (Batches, Candidates, Ledger, CRM Leads), only when NOTION_TOKEN is set.
      const { notionConfig, syncNow } = await import("./lib/notion/sync");
      if (notionConfig()) {
        const every = Math.max(30, Number(process.env.NOTION_SYNC_INTERVAL_SEC) || 60) * 1000;
        const sync = () => void syncNow(db)?.catch(() => undefined);
        setTimeout(sync, 45_000);
        setInterval(sync, every).unref?.();
      }
    }
  }
}
