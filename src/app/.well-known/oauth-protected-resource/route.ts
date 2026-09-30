import { issuer } from "@/lib/mcp/oauth";
import { jsonHeaders, protectedResourceMetadata } from "@/lib/mcp/metadata";

/** RFC 9728, for the whole origin: the MCP server's clients read this from the 401's WWW-Authenticate pointer. */
export async function GET(request: Request) {
  return Response.json(protectedResourceMetadata(issuer(request)), { headers: jsonHeaders });
}
