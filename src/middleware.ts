import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Coarse gate: no valid session cookie -> /login. Real permission checks happen in server code
// (requireUser / requireCan), which also re-validates the user against the database.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (session && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
