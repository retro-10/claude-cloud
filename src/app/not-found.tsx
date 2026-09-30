import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="font-display text-7xl font-semibold text-brand/80">404</span>
      <h1 className="page-title">Not found</h1>
      <p className="text-sm text-muted">That page or record does not exist, or you do not have access to it.</p>
      <Link href="/" className="btn btn-primary">
        Go to Today
      </Link>
    </main>
  );
}
