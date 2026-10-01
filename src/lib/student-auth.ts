import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { studentFromSession } from "./portal";
import { STUDENT_COOKIE, verifyStudent } from "./session";

/** The signed-in student, re-checked against the database on every request (like staff sessions). */
export async function getStudent() {
  const s = await verifyStudent((await cookies()).get(STUDENT_COOKIE)?.value);
  return s ? studentFromSession(db, s) : null;
}

/** For portal pages and portal actions: the student, or the portal sign-in page. */
export async function requireStudent() {
  const s = await getStudent();
  if (!s) redirect("/portal/login");
  return s;
}
