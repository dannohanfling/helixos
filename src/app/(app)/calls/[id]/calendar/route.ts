import { apiViewer } from "@/lib/auth";
import { callIcs, visibleTo } from "@/lib/engine/calls";
import { callWithSkips } from "@/lib/calls";

/**
 * Add to calendar for one weekly call (H-820, plan H-828): an .ics that repeats every week in the call's own zone, the
 * skipped dates left out, the link and passcode in the description. Only a call the member's level can see (a team member
 * reads on the owner's); anything else reads as not there. Nothing about the member goes in the file.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "no-store, private", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

export async function GET(_request: Request, { params }: RouteContext<"/calls/[id]/calendar">) {
  const v = await apiViewer({ team: "allow" });
  if (!v) return new Response("Sign in first.", { status: 401, headers: HEADERS });
  const { id } = await params;
  const found = await callWithSkips(v.workspace.id, id);
  if (!found || !found.call.active || !visibleTo(found.call, { role: v.role, programTier: v.membership.programTier })) return new Response("That call isn't on your calendar.", { status: 404, headers: HEADERS });
  const body = callIcs(found.call, found.skips, { link: v.workspace.callsLink, passcode: v.workspace.callsPasscode });
  const file = found.call.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "call";
  return new Response(body, { status: 200, headers: { ...HEADERS, "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${file}.ics"` } });
}
