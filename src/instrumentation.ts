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
      // Vercel runs code only for requests: there /api/cron/tick does this work when the scheduler calls it
      if (process.env.VERCEL) return;
      const { db } = await import("./db");
      const { runTick } = await import("./lib/tick");
      const tick = () => void runTick(db, { backup: true, notion: false }).catch(() => undefined);
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
