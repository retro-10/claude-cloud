import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center gap-3 px-4">
      <h1 className="font-display text-2xl">Not found</h1>
      <p className="text-sm text-muted">That page or record does not exist, or you do not have access to it.</p>
      <Link href="/" className="text-sm underline">
        Go to Today
      </Link>
    </main>
  );
}
