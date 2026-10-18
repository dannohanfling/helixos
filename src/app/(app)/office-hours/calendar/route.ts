import { apiViewer } from "@/lib/auth";
import { OOH_FRIDAYS, upcomingFridays } from "@/lib/engine/office-hours";
import { hostToday, oohSchedule, sessionStart } from "@/lib/engine/ooh-session";
import { callWhen, icsFile } from "@/lib/hermes/when";

/**
 * Add to calendar (H-457): one upcoming Office Hours session as an .ics event with a 15-minute alarm. The start and end are
 * UTC instants, so the member's own calendar shows it at their local time; the host's zone rides along as a hint. Nothing
 * about the member or their request goes in the file, only the session and the join link.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "no-store, private", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

export async function GET(request: Request) {
  const v = await apiViewer({ team: "allow" });
  if (!v) return new Response("Sign in first.", { status: 401, headers: HEADERS });
  const day = new URL(request.url).searchParams.get("day") ?? "";
  const session = oohSchedule(v.workspace);
  const at = upcomingFridays(hostToday(session), OOH_FRIDAYS, session.weekday).includes(day) ? sessionStart(day, session) : null;
  if (!at) return new Response("That session isn't on the calendar.", { status: 404, headers: HEADERS });
  const when = callWhen(at.toISOString(), v.tz, session.minutes);
  const body = icsFile({
    uid: `ooh-${v.workspace.id}-${day}@helixos`,
    title: "Office Hours",
    details: `Office Hours, ${when.full}.${v.workspace.oohLink ? ` Join: ${v.workspace.oohLink}` : ""}`,
    when,
    location: v.workspace.oohLink,
    zone: session.hostTz,
  });
  return new Response(body, { status: 200, headers: { ...HEADERS, "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="office-hours-${day}.ics"` } });
}
