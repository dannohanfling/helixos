import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { nowIso } from "@/lib/dates";

/**
 * Where the pass provider sends a member after they add their Evolve Omega pass (H-1640, plan H-1641): landing here is the
 * sign the pass was added, so the member's own pass is marked added (the first time only) and they land on Rewards with the
 * "Pass added" state. Someone without a pass, or a coach switched into a client, just lands on Rewards; nothing is marked.
 */
export async function GET(request: Request) {
  const v = await apiViewer();
  if (!v) return NextResponse.redirect(new URL("/login", request.url), 303);
  const m = v.membership;
  const hasPass = Boolean(m.eoCustomerId || m.eoPassUrl);
  if (!hasPass || v.switchedInto) return NextResponse.redirect(new URL("/rewards", request.url), 303);
  if (!m.eoPassInstalledAt) await db.update(schema.memberships).set({ eoPassInstalledAt: nowIso() }).where(eq(schema.memberships.id, m.id));
  return NextResponse.redirect(new URL("/rewards?pass=added#eo-pass", request.url), 303);
}
