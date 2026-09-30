import { jsonHeaders } from "@/lib/mcp/metadata";
import { clientById, exchangeCode, issuer, refreshTokens, resourceFor } from "@/lib/mcp/oauth";
import { allow, clientIp } from "@/lib/rate-limit";

/**
 * The token endpoint (OAuth 2.1): a code plus its PKCE verifier for an access and a refresh token, or a refresh token for
 * a new pair. Form-encoded or JSON. Errors are RFC 6749's, never a stack trace; nothing here is cached.
 */
export async function POST(request: Request) {
  if (!(await allow(`oauth:token:${await clientIp()}`, 30, 60 * 1000))) return Response.json({ error: "too_many_requests" }, { status: 429, headers: jsonHeaders });
  const p = await params(request);
  const clientId = p.client_id ?? "";
  const client = clientId ? await clientById(clientId) : null;
  if (!client) return Response.json({ error: "invalid_client", error_description: "unknown client_id" }, { status: 401, headers: jsonHeaders });
  const grant = p.grant_type ?? "";
  if (grant === "authorization_code") {
    if (!p.code || !p.code_verifier || !p.redirect_uri) return Response.json({ error: "invalid_request", error_description: "code, code_verifier and redirect_uri are required" }, { status: 400, headers: jsonHeaders });
    const r = await exchangeCode({ code: p.code, verifier: p.code_verifier, clientId, redirectUri: p.redirect_uri, resource: p.resource ?? null, expectedResource: resourceFor(issuer(request)) });
    return "error" in r ? Response.json(r, { status: 400, headers: jsonHeaders }) : Response.json(r, { headers: jsonHeaders });
  }
  if (grant === "refresh_token") {
    if (!p.refresh_token) return Response.json({ error: "invalid_request", error_description: "refresh_token is required" }, { status: 400, headers: jsonHeaders });
    const r = await refreshTokens(p.refresh_token, clientId);
    return "error" in r ? Response.json(r, { status: 400, headers: jsonHeaders }) : Response.json(r, { headers: jsonHeaders });
  }
  return Response.json({ error: "unsupported_grant_type", error_description: "authorization_code or refresh_token" }, { status: 400, headers: jsonHeaders });
}

async function params(request: Request): Promise<Record<string, string>> {
  const ct = request.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const j = (await request.json()) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === "string") as [string, string][]);
    }
    return Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return {};
  }
}
