import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { authorizeUrl, whoopConfigured } from "@/lib/whoop";

/**
 * GET /api/body/whoop/start: the signed-in member (Body on, never a coach switched in) is sent to WHOOP to say yes. The state is a
 * nonce in an httpOnly cookie, checked on return. The redirect URI is this site's /api/body/whoop/callback.
 */
export async function GET(request: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.redirect(new URL("/login", request.url));
  if (!v.membership.bodyEnabled || v.switchedInto) return NextResponse.redirect(new URL("/today", request.url));
  if (!whoopConfigured()) return NextResponse.redirect(new URL("/body/settings?error=WHOOP%20isn%27t%20set%20up%20on%20this%20server%20yet.", request.url));
  const state = randomBytes(16).toString("base64url");
  const jar = await cookies();
  jar.set("whoop_state", state, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/api/body/whoop", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(new URL("/api/body/whoop/callback", request.url).toString(), state));
}
