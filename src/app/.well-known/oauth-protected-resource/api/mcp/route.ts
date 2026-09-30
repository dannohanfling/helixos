import { issuer } from "@/lib/mcp/oauth";
import { jsonHeaders, protectedResourceMetadata } from "@/lib/mcp/metadata";

/** RFC 9728, path-specific for /api/mcp: the same document, for clients that look it up by the resource's own path. */
export async function GET(request: Request) {
  return Response.json(protectedResourceMetadata(issuer(request)), { headers: jsonHeaders });
}
