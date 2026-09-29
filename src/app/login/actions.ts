"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { authenticate } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { SESSION_COOKIE, cookieOptions, signSession } from "@/lib/session";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export type LoginState = { error?: string };

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const email = parsed.data.email.toLowerCase();
  // 5 attempts per 15 min per email+IP, and 20 per 15 min per IP overall
  const perAccount = rateLimit(`login:${ip}:${email}`, 5, 15 * 60_000);
  const perIp = rateLimit(`login-ip:${ip}`, 20, 15 * 60_000);
  if (!perAccount.ok || !perIp.ok) return { error: "Too many attempts. Try again in a few minutes." };

  const user = await authenticate(db, email, parsed.data.password);
  if (!user) {
    await audit(db, { userId: null, entity: "auth", action: "login_failed" });
    return { error: "Wrong email or password." };
  }

  cookies().set(SESSION_COOKIE, await signSession(user), cookieOptions());
  await audit(db, { userId: user.id, entity: "auth", entityId: user.id, action: "login" });
  redirect("/");
}

export async function logout() {
  cookies().delete(SESSION_COOKIE);
  redirect("/login");
}
