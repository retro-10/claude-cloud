import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { passwordVersion } from "./password-version";
import { can, type Action } from "./rbac";
import { SESSION_COOKIE, verifySession, type SessionUser } from "./session";

export type CurrentUser = SessionUser & { passwordChanged: boolean };

// Re-reads the user row so deactivation, role changes and password changes apply immediately,
// not at token expiry.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [u] = await db.select().from(users).where(eq(users.id, session.id)).limit(1);
  if (!u || !u.active) return null;
  if (session.pv !== passwordVersion(u.passwordHash)) return null; // password changed since this sign-in
  return { id: u.id, name: u.name, email: u.email, role: u.role, passwordChanged: u.passwordChangedAt !== null };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// Server-side permission check. Call at the top of every server action and route handler that writes.
export async function requireCan(action: Action): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, action)) throw new Error("Forbidden");
  return user;
}

// For pages (not actions): a signed-in user without the permission gets the "not found" page, the same
// as for a record they cannot see, instead of an error. Actions keep throwing: they are only ever
// reached by a crafted request, never by a normal click.
export async function requirePageCan(action: Action): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, action)) notFound();
  return user;
}
