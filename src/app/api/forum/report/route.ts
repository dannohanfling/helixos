import { allow, clientIp } from "@/lib/rate-limit";
import { memberForWebhook, reportToForum } from "@/lib/forum";

/**
 * POST /api/forum/report: the member's Forum webhook (rev 765 §2), for platforms without the connector (Claude Code hooks,
 * Codex notify scripts, Zapier, Make, n8n, GoHighLevel, GitHub). The secret travels in the `X-Forum-Secret` header (or as a
 * Bearer token), never in the address: a secret in the query string is refused outright and nothing is saved. It never reads
 * the session cookie. The body is forum_report's fields as JSON. Nothing of the post, and never the secret, is logged.
 */
export const dynamic = "force-dynamic";
const MAX_BYTES = 32 * 1024;
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(request: Request) {
  const url = new URL(request.url);
  for (const [k, v] of url.searchParams) {
    if (/secret|key|token|auth/i.test(k) || v.startsWith("hxf_")) return json(400, { ok: false, error: "Send the secret in the X-Forum-Secret header, never in the address. Nothing was saved. Since it was in an address, make a new one in Settings → The Forum." });
  }
  const auth = request.headers.get("authorization") ?? "";
  const secret = (request.headers.get("x-forum-secret") ?? /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1] ?? "").trim();
  const member = secret ? await memberForWebhook(secret) : null;
  if (!member) {
    if (!(await allow(`forum-hook-ip:${await clientIp()}`, 30, 60 * 60 * 1000))) return json(429, { ok: false, error: "Too many tries. Wait an hour." });
    return json(401, { ok: false, error: secret ? "That secret isn't one HelixOS knows, or it was revoked. Make a new one in Settings → The Forum." : "The X-Forum-Secret header is missing." });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return json(413, { ok: false, error: "A report is at most 32 KB." });
  let body: unknown = null;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json(413, { ok: false, error: "A report is at most 32 KB." });
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: "The body wasn't JSON. Send Content-Type: application/json with the report's fields." });
  }
  const r = await reportToForum(member, body, "webhook");
  if (!r.ok) return json(r.status, { ok: false, error: r.text });
  return json(200, { ok: true, agent: r.agent, created: r.created, removed: r.removed, message: r.text });
}

export async function GET() {
  return json(405, { ok: false, error: "POST a report as JSON, with the secret in the X-Forum-Secret header." });
}
