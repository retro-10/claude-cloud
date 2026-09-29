"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { authenticate } from "@/lib/auth";
import { clearHits, isLimited, recordHit } from "@/lib/rate-limit";
import { SESSION_COOKIE, cookieOptions, signSession } from "@/lib/session";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

// Configurable so automated test runs (which sign in constantly) are not throttled; keep the defaults in production.
const MAX_PER_ACCOUNT = Number(process.env.LOGIN_MAX_FAILED_PER_ACCOUNT ?? 5);
const MAX_PER_IP = Number(process.env.LOGIN_MAX_FAILED_PER_IP ?? 20);

export type LoginState = { error?: string };

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const email = parsed.data.email.toLowerCase();
  // Only FAILED attempts count: 5 per 15 min per email+IP, and 20 per 15 min per IP overall.
  // Signing in normally (or several times) never locks anyone out; guessing does.
  const WINDOW = 15 * 60_000;
  const acct = `login:${ip}:${email}`;
  const ipKey = `login-ip:${ip}`;
  if (isLimited(acct, MAX_PER_ACCOUNT, WINDOW).limited || isLimited(ipKey, MAX_PER_IP, WINDOW).limited) {
    return { error: "Too many failed attempts. Try again in a few minutes." };
  }

  const user = await authenticate(db, email, parsed.data.password);
  if (!user) {
    recordHit(acct, WINDOW);
    recordHit(ipKey, WINDOW);
    await audit(db, { userId: null, entity: "auth", action: "login_failed" });
    return { error: "Wrong email or password." };
  }
  clearHits(acct);

  const { pv, ...sessionUser } = user;
  (await cookies()).set(SESSION_COOKIE, await signSession(sessionUser, pv), cookieOptions());
  await audit(db, { userId: user.id, entity: "auth", entityId: user.id, action: "login" });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
