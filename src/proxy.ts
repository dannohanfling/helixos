import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

// Inbound machine endpoints authenticate with their own secrets, never a browser session.
// The manifest and icons must load without a session: the browser fetches them on the login page and when installing the app.
// /g (a lead magnet's tracked link), /m (its hosted page) and /files (its public objects, and only those) are read by strangers.
const PUBLIC = ["/login", "/join", "/demo", "/setup", "/forgot", "/reset", "/api/cron", "/api/health", "/api/webhooks", "/api/session", "/manifest.webmanifest", "/icon", "/apple-icon", "/pwa-icon", "/robots.txt", "/g", "/m", "/files"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Generated image routes carry a hash suffix (/opengraph-image-abc123), so those two match by prefix.
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/")) || /^\/(opengraph|twitter)-image/.test(pathname);
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (pathname === "/login" && hasSession) {
    return NextResponse.redirect(new URL("/today", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|svg|jpg|webp)$).*)"],
};
