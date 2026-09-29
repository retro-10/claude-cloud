import { logout } from "./login/actions";
import { requireUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// Placeholder home. The Today view replaces this in Phase 5.
export default async function Home() {
  const user = await requireUser();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <span className="font-semibold">OrlaDent Camp CRM</span>
        <form action={logout}>
          <button className="text-sm text-muted underline">Sign out</button>
        </form>
      </header>
      <h1 className="font-display text-2xl">Signed in as {user.name}</h1>
      <p className="mt-2 text-sm text-muted">Role: {user.role}</p>
    </main>
  );
}
