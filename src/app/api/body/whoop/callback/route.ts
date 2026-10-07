import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiViewer } from "@/lib/auth";
import { connectWhoop, syncWhoop } from "@/lib/body-whoop";
import { exchangeCode, WhoopError, whoopProblem } from "@/lib/whoop";

/**
 * GET /api/body/whoop/callback?code=&state=: back from WHOOP. The state must match the cookie; the code is exchanged, the tokens
 * sealed, the member's WHOOP id read, and the last 30 days pulled. Then Body settings says connected. Nothing of the code or
 * the tokens goes in a URL, a log or an error.
 */
// The first pull is thirty days of four WHOOP collections: give it the time.
export const maxDuration = 60;

export async function GET(request: Request) {
  const v = await apiViewer();
  const back = (error?: string) => NextResponse.redirect(new URL(`/body/settings${error ? `?error=${encodeURIComponent(error)}` : "?whoop=connected"}#devices`, request.url));
  if (!v) return NextResponse.redirect(new URL("/login", request.url));
  if (!v.membership.bodyEnabled || v.switchedInto) return NextResponse.redirect(new URL("/today", request.url));
  const url = new URL(request.url);
  const jar = await cookies();
  const state = jar.get("whoop_state")?.value;
  jar.delete("whoop_state");
  if (!state || url.searchParams.get("state") !== state) return back("That WHOOP sign-in didn't come back the way it left. Try Connect again.");
  if (url.searchParams.get("error")) return back("WHOOP didn't connect: you said no, or WHOOP refused. Nothing changed.");
  const code = url.searchParams.get("code") ?? "";
  if (!code) return back("WHOOP sent no code back. Try Connect again.");
  try {
    const tokens = await exchangeCode(code, new URL("/api/body/whoop/callback", request.url).toString());
    await connectWhoop(v.workspace.id, v.user.id, tokens);
    await syncWhoop(v.workspace.id, v.user.id, v.tz, 30).catch(() => null);
    return back();
  } catch (e) {
    return back(e instanceof WhoopError ? whoopProblem(e) : "WHOOP couldn't connect just now. Nothing changed.");
  }
}
