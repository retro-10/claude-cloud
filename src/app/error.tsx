"use client";

// Shown when a page fails unexpectedly. Deliberately generic: the real error (which can contain
// database details) stays in the server log, and we never print it here.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center gap-3 px-4">
      <h1 className="font-display text-2xl">Something went wrong</h1>
      <p className="text-sm text-muted">The page could not be loaded. Nothing you entered has been lost from the database. Try again, and tell the owner if it keeps happening.</p>
      <div className="flex gap-3">
        <button onClick={reset} className="rounded bg-gold px-3 py-2 text-sm font-medium text-ink">
          Try again
        </button>
        {/* a plain link so it still works if client navigation is what broke */}
        <a href="/" className="px-3 py-2 text-sm underline">
          Go to Today
        </a>
      </div>
    </main>
  );
}
