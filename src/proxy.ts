import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { safeNext } from "@/lib/engine/next-path";

// Inbound machine endpoints authenticate with their own secrets, never a browser session.
// The manifest and icons must load without a session: the browser fetches them on the login page and when installing the app.
// /g (a lead magnet's tracked link), /m (its hosted page) and /files (its public objects, and only those) are read by strangers.
// /api/public holds feeds made to be read by anyone (a client's loyalty leaderboard, rev 639): no member data beyond what they show.
// /lb is the hosted leaderboard page itself (H-28): the same data as its feed, rendered; shared and embedded by the client.
const PUBLIC = ["/login", "/join", "/demo", "/setup", "/forgot", "/reset", "/email-change", "/removed", "/api/cron", "/api/health", "/api/webhooks", "/api/chat-link", "/api/csp-report", "/api/mcp", "/api/bot-mcp", "/api/mf", "/mf", "/api/body/health-weigh-in", "/api/forum/report", "/api/handoff/files", "/oauth/register", "/oauth/token", "/oauth/revoke", "/.well-known", "/api/session", "/manifest.webmanifest", "/icon", "/apple-icon", "/pwa-icon", "/robots.txt", "/g", "/m", "/files", "/api/public", "/lb"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Generated image routes carry a hash suffix (/opengraph-image-abc123), so those two match by prefix.
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/")) || /^\/(opengraph|twitter)-image/.test(pathname);
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // The whole address, query included: the OAuth consent screen (/oauth/authorize?client_id=...) needs its parameters back.
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  // Signed in already: on to where they were going (rev 843 keeps it), else Today. A cookie that doesn't verify is cleared by
  // the page it lands on (/api/session/clear), so this never loops.
  if (pathname === "/login" && hasSession) {
    return NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|svg|jpg|webp)$).*)"],
};
