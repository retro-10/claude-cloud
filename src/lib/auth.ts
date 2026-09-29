import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import type { SessionUser } from "./session";

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export async function authenticate(
  db: Pick<Db, "select">,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !ok) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
