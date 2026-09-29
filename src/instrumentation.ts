// Runs once when the server starts (Next.js instrumentation hook).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Next.js logs unhandled errors with console.error. A database error object carries query parameters
    // (lead names, phone numbers), so scrub every logged error. See src/lib/redact.ts.
    const { installLogScrubber } = await import("./lib/redact");
    installLogScrubber();
  }
}
