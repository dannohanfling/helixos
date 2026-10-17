import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";

/**
 * The streak flame's one write (H-558): the streak day whose surge has played, on the member's own row, so it plays once a
 * day. A plain request rather than a server action, so it never shares the router's action queue with a form the member is
 * filling in. A coach switched into a client stamps nothing; a team member has no pill and gets the 401 apiViewer gives them.
 */
export async function POST(request: Request) {
  const ok = () => new NextResponse(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  const v = await apiViewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (v.switchedInto) return ok();
  let day: unknown = null;
  try {
    day = ((await request.json()) as { day?: unknown }).day;
  } catch {
    return NextResponse.json({ error: "Send the day." }, { status: 400 });
  }
  // Only today's streak day or yesterday's (inside the late close-out window); never a day ahead.
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day > v.today) return NextResponse.json({ error: "Send the day." }, { status: 400 });
  await db.update(schema.memberships).set({ streakSurgeSeenOn: day }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, v.workspace.id)));
  return ok();
}
