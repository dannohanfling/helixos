import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SETUP_RESULT_COOKIE } from "@/lib/setup";

/** Leaves the one-time invite-links page: clears the links cookie and goes into the app. A route handler, so the cookie change and the redirect are one response. */
export async function GET(request: Request) {
  const jar = await cookies();
  jar.delete({ name: SETUP_RESULT_COOKIE, path: "/setup" });
  return NextResponse.redirect(new URL("/today", request.url));
}
