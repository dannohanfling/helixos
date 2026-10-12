import { allow, clientIp } from "@/lib/rate-limit";
import { logSync } from "@/lib/integrations";
import { isMfCode } from "@/lib/engine/magic-funnel";
import { pageRegistered } from "@/lib/mf/data";

/**
 * The snippet's own signal on submit (rev 812 §2, the backup; GoHighLevel's workflow webhook is the source of truth): from the
 * member's funnel domain only, once per person. Nothing comes back but a status. The log keeps the code's start and the outcome.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const headers = { "cache-control": "no-store", "x-robots-tag": "noindex" };
  if (!isMfCode(code) || !(await allow(`mf:reg:${await clientIp()}`, 30, 60_000))) return new Response(null, { status: 204, headers });
  const r = await pageRegistered(code, request.headers.get("origin"));
  if (r.member) await logSync({ workspaceId: r.member.workspaceId, userId: r.member.userId, provider: "magic_funnel", direction: "in", event: "mf:registered", payload: {}, status: r.ok ? "received" : "skipped", note: `${code.slice(0, 6)}… · page signal · ${r.outcome}` });
  return new Response(null, { status: 204, headers });
}
