import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { can, type Action } from "./rbac";
import { SESSION_COOKIE, verifySession, type SessionUser } from "./session";

// Re-reads the user row so deactivation and role changes apply immediately, not at token expiry.
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [u] = await db.select().from(users).where(eq(users.id, session.id)).limit(1);
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// Server-side permission check. Call at the top of every server action and route handler that writes.
export async function requireCan(action: Action): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, action)) throw new Error("Forbidden");
  return user;
}
