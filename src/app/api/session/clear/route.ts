import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";

/** Drops a session cookie that no longer verifies (for example after a password change on another device) and sends the user to sign in. */
export async function GET(request: Request) {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/login?reason=signed-out", request.url));
}
