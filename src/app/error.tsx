"use client";

// Shown when a page fails unexpectedly. Deliberately generic: the real error (which can contain
// database details) is scrubbed and stays in the server log; we never print it here.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center gap-3 px-4">
      <h1 className="page-title">Something went wrong</h1>
      <p className="text-sm text-muted">
        The page could not be loaded, and your last change may not have been saved. Check the record and try again. If it keeps
        happening, tell the owner.
      </p>
      <div className="flex gap-3">
        <button onClick={reset} className="btn btn-primary">
          Try again
        </button>
        {/* A plain link on purpose: a full page load still works if client-side navigation is what broke. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="btn btn-ghost">
          Go to Today
        </a>
      </div>
    </main>
  );
}
