import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { driveAuthUrl } from "@/lib/drive";
import { publicBaseUrl } from "@/lib/public-url";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";
import { STATE_COOKIE, STATE_PATH, callbackUrl } from "../shared";

export const dynamic = "force-dynamic";

// Owners only: sends the browser to Google to pick the account whose Drive keeps the files. The random state,
// also kept in a short-lived cookie, ties Google's answer to this browser (no forged callbacks).
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "settings:write")) return new NextResponse("Forbidden", { status: 403 });
  const state = randomBytes(24).toString("base64url");
  const url = driveAuthUrl(await callbackUrl(), state);
  const base = await publicBaseUrl();
  if (!url) return NextResponse.redirect(`${base}/settings/integrations?error=${encodeURIComponent("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server first")}`);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: STATE_PATH,
    maxAge: 600,
  });
  return res;
}
