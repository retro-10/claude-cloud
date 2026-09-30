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
      const { db } = await import("./db");
      const { runScheduledRules } = await import("./lib/workflows");
      const tick = () => runScheduledRules(db).catch(() => 0);
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
