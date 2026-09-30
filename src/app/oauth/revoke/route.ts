import { jsonHeaders } from "@/lib/mcp/metadata";
import { revokeByToken } from "@/lib/mcp/oauth";
import { allow, clientIp } from "@/lib/rate-limit";

/** RFC 7009: either token of a grant ends the grant. 200 whether or not the token was known, so nothing can be probed. */
export async function POST(request: Request) {
  if (!(await allow(`oauth:revoke:${await clientIp()}`, 30, 60 * 1000))) return Response.json({ error: "too_many_requests" }, { status: 429, headers: jsonHeaders });
  let token = "";
  try {
    const ct = request.headers.get("content-type") ?? "";
    token = ct.includes("application/json") ? String(((await request.json()) as { token?: unknown }).token ?? "") : (new URLSearchParams(await request.text()).get("token") ?? "");
  } catch {
    token = "";
  }
  if (token) await revokeByToken(token);
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}
