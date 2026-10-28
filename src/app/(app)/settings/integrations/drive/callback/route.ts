import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { connectDrive } from "@/lib/drive";
import { publicBaseUrl } from "@/lib/public-url";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";
import { STATE_COOKIE, STATE_PATH, callbackUrl } from "../shared";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Google sends the owner back here with a one-time code, exchanged for a refresh token that is stored encrypted.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "settings:write")) return new NextResponse("Forbidden", { status: 403 });
  const base = await publicBaseUrl();
  const back = (kind: "notice" | "error", msg: string) => {
    const res = NextResponse.redirect(`${base}/settings/integrations?${kind}=${encodeURIComponent(msg)}`);
    res.cookies.delete({ name: STATE_COOKIE, path: STATE_PATH });
    return res;
  };
  const q = req.nextUrl.searchParams;
  const state = req.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!state || !same(state, q.get("state") ?? "")) return back("error", "That Google sign-in expired or did not start here; try Connect again");
  if (q.get("error")) return back("error", q.get("error") === "access_denied" ? "Google Drive was not connected (access was declined)" : `Google sign-in failed (${q.get("error")})`);
  const code = q.get("code");
  if (!code) return back("error", "Google did not send a sign-in code");
  const r = await connectDrive(db, code, await callbackUrl(), user.id);
  return r.ok ? back("notice", `Google Drive connected${r.email ? ` (${r.email})` : ""}. New files are saved there.`) : back("error", r.error);
}
