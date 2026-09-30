import { issuer } from "@/lib/mcp/oauth";
import { authorizationServerMetadata, jsonHeaders } from "@/lib/mcp/metadata";

/** RFC 8414: HelixOS is its own authorization server for the MCP server. */
export async function GET(request: Request) {
  return Response.json(authorizationServerMetadata(issuer(request)), { headers: jsonHeaders });
}
