import { allow, clientIp } from "@/lib/rate-limit";
import { logSync } from "@/lib/integrations";
import { isMfCode } from "@/lib/engine/magic-funnel";
import { publicRead } from "@/lib/mf/data";

/**
 * The Magic funnel's public read (revs 812 §4, 815): the snippet on the member's GoHighLevel page asks for one prospect's page
 * by the code in ?mf=. Only the member's funnel domains get an answer (CORS); never cached, noindex, rate limited per code and
 * per address. The log keeps the start of the code, the webinar and the outcome: never a name, an email or a word of the page.
 */
export const dynamic = "force-dynamic";

const BASE = { "content-type": "application/json", "cache-control": "no-store, private", "x-robots-tag": "noindex, nofollow", vary: "Origin", "referrer-policy": "no-referrer" };
const cors = (origin: string | null): Record<string, string> => (origin ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET", "access-control-max-age": "600" } : {});
const reply = (status: number, body: unknown, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { ...BASE, ...cors(origin) } });

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ip = await clientIp();
  if (!(await allow(`mf:ip:${ip}`, 60, 60_000))) return reply(429, { state: "generic", error: "busy" });
  if (!isMfCode(code)) return reply(200, { state: "generic" });
  if (!(await allow(`mf:code:${code}`, 30, 60_000))) return reply(429, { state: "generic", error: "busy" });
  const r = await publicRead(code, request.headers.get("origin"));
  if (r.member) await logSync({ workspaceId: r.member.workspaceId, userId: r.member.userId, provider: "magic_funnel", direction: "in", event: "mf:read", payload: {}, status: r.status === 200 ? "received" : "skipped", note: `${code.slice(0, 6)}… · webinar ${r.webinarId} · ${r.outcome}` });
  return reply(r.status, r.body, r.origin);
}

/** A plain GET needs no preflight, so none is granted. */
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...BASE, allow: "GET" } });
}
