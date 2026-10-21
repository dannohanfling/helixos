import { confirmedView } from "@/lib/hermes/data";
import { HOST } from "@/lib/hermes/copy";
import { icsFile } from "@/lib/hermes/when";
import { allow, clientIp } from "@/lib/rate-limit";

/** Apple / Outlook: the call as one .ics event with a 15-minute alarm. Only for a registered code; nothing personal in the file. */
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "no-store, private", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!(await allow(`hermes:ip:${await clientIp()}`, 60, 60_000))) return new Response("Too many tries just now.", { status: 429, headers: HEADERS });
  const v = await confirmedView(code);
  if (!v) return new Response("Not found", { status: 404, headers: HEADERS });
  const w = v.ctx.when;
  const body = icsFile({
    uid: `${v.ctx.webinarId}-${code.slice(0, 12)}@helixos`,
    title: v.ctx.title,
    details: `${v.ctx.title} with ${HOST}. ${w.full}. ${v.ctx.joinUrl ? `Join: ${v.ctx.joinUrl}` : "Your join link comes to you in Messenger."}`,
    when: w,
    location: v.ctx.joinUrl,
    // The host's zone named in the file (H-457); the times stay UTC instants, which every calendar shows in its owner's own time.
    zone: v.ctx.tz,
  });
  return new Response(body, { status: 200, headers: { ...HEADERS, "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="inner-circle-call-${w.isoDay}.ics"` } });
}
