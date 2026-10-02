import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, unseal } from "@/lib/auth/seal";

// All of Atlas sits behind Google sign-in, and only the owner's account can get a
// session (see the OAuth callback). Server Functions and API routes check the session
// again themselves; this is the outer lock.

export function proxy(request: NextRequest) {
  if (unseal(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return Response.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.redirect(new URL("/signin", request.url));
}

export const config = {
  // Open without a session: the sign-in page and flow, the scheduled jobs (they carry
  // CRON_SECRET), and what a phone needs to install the app (manifest, icons, service worker).
  matcher: ["/((?!signin|api/auth/|api/cron/|_next/static|_next/image|manifest\\.webmanifest|icons/|icon\\.svg|sw\\.js).*)"],
};
