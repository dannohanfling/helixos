import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { aqueductFor } from "@/lib/aqueduct";
import { nextSeen, readSeen, seenChanged } from "@/lib/engine/aqueduct-repair";

/**
 * The Aqueduct's one write for the repair moment (H-637 PR 2): the leak the member has now seen, so a repair plays once and
 * never on a first visit. It takes nothing from the browser: the leak is read again here from the member's own counts. A plain
 * request rather than a server action, so it never shares the router's action queue with a form (as the streak flame's, H-558).
 * A coach switched into a client stamps nothing; a team member gets the 401 apiViewer gives them.
 */
export async function POST() {
  const ok = () => new NextResponse(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  const v = await apiViewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (v.switchedInto) return ok();
  const a = await aqueductFor(v);
  const seen = readSeen(v.membership.aqueductRepairSeen);
  const next = nextSeen(seen, a.leak, a.period, v.today);
  if (seenChanged(seen, next)) await db.update(schema.memberships).set({ aqueductRepairSeen: next }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, v.workspace.id)));
  return ok();
}
