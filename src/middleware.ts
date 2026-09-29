import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Cross-site request forgery, defence in depth on top of SameSite=Lax cookies and Next's own check for
// server actions: a state-changing request that names an Origin must name our own host.
// (Behind a reverse proxy the public host arrives in X-Forwarded-Host.)
function crossOriginWrite(req: NextRequest): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const origin = req.headers.get("origin");
  if (!origin) return false; // not a browser cross-site request
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

// Set at runtime (not in next.config, which is frozen at build time) so HSTS follows COOKIE_SECURE.
// Google Fonts is the only third-party host, for stylesheets and font files. Inline scripts are needed
// by Next's own bootstrapping; everything else is locked to this origin.
function withSecurityHeaders(res: NextResponse): NextResponse {
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.COOKIE_SECURE === "true") res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

// Coarse gate: no valid session cookie -> /login. Real permission checks happen in server code
// (requireUser / requireCan), which also re-validates the user against the database, so a cookie that
// is signed but stale (user deactivated, password changed) is rejected there. That is why /login must NOT
// bounce signed-in users to "/" from here: a stale cookie would loop between the two.
export async function middleware(req: NextRequest) {
  if (crossOriginWrite(req)) return withSecurityHeaders(new NextResponse("Forbidden", { status: 403 }));

  const { pathname } = req.nextUrl;
  if (pathname === "/api/health") return withSecurityHeaders(NextResponse.next());

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session && pathname !== "/login") {
    return withSecurityHeaders(NextResponse.redirect(new URL("/login", req.url)));
  }
  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
