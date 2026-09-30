import { SCOPE_NAMES } from "@/lib/engine/mcp";
import { resourceFor } from "@/lib/mcp/oauth";

/** RFC 9728: where the MCP server's clients find its authorization server. */
export function protectedResourceMetadata(iss: string) {
  return { resource: resourceFor(iss), authorization_servers: [iss], scopes_supported: [...SCOPE_NAMES], bearer_methods_supported: ["header"], resource_name: "HelixOS" };
}

/** RFC 8414: the authorization server's endpoints and what it accepts. PKCE S256 only, public clients only. */
export function authorizationServerMetadata(iss: string) {
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    registration_endpoint: `${iss}/oauth/register`,
    revocation_endpoint: `${iss}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...SCOPE_NAMES],
    service_documentation: `${iss}/connect`,
  };
}

export const jsonHeaders = { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache" };
