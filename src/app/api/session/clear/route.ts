import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";
import { safeNext } from "@/lib/engine/next-path";

/**
 * Drops a session cookie that no longer verifies (a password changed on another device, an old or broken cookie) and sends the
 * person to sign in, keeping where they were going (rev 843). With no cookie at all it is a plain sign-in, with no message.
 */
export async function GET(request: Request) {
  const jar = await cookies();
  const had = Boolean(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  const url = new URL("/login", request.url);
  const next = new URL(request.url).searchParams.get("next");
  if (next) url.searchParams.set("next", safeNext(next));
  if (had) url.searchParams.set("reason", "signed-out");
  return NextResponse.redirect(url);
}
