import { redirectUriOk } from "@/lib/engine/mcp";
import { jsonHeaders } from "@/lib/mcp/metadata";
import { registerClient } from "@/lib/mcp/oauth";
import { allow, clientIp } from "@/lib/rate-limit";

/**
 * Dynamic client registration (RFC 7591), as the MCP authorization spec expects: Claude's connector registers itself and
 * gets a client id. Public clients only (no secret; PKCE carries the proof), https redirect URIs only (localhost in
 * development), at most ten, and a client never changes its URIs afterwards. Ten registrations an hour per address.
 */
export async function POST(request: Request) {
  if (!(await allow(`oauth:register:${await clientIp()}`, 10, 60 * 60 * 1000))) return Response.json({ error: "too_many_requests", error_description: "try again in an hour" }, { status: 429, headers: jsonHeaders });
  let body: { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown; grant_types?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "send JSON" }, { status: 400, headers: jsonHeaders });
  }
  const dev = process.env.NODE_ENV !== "production";
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10) return Response.json({ error: "invalid_redirect_uri", error_description: "one to ten redirect_uris are required" }, { status: 400, headers: jsonHeaders });
  const bad = uris.find((u) => !redirectUriOk(u, dev));
  if (bad) return Response.json({ error: "invalid_redirect_uri", error_description: `redirect URIs must be https (${bad})` }, { status: 400, headers: jsonHeaders });
  if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") return Response.json({ error: "invalid_client_metadata", error_description: "public clients only: token_endpoint_auth_method must be none" }, { status: 400, headers: jsonHeaders });
  const name = (typeof body.client_name === "string" ? body.client_name.trim() : "").slice(0, 100) || "An app";
  const client = await registerClient(name, [...new Set(uris)]);
  return Response.json({ client_id: client.id, client_name: client.name, redirect_uris: client.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], client_id_issued_at: Math.floor(Date.now() / 1000) }, { status: 201, headers: jsonHeaders });
}
