import { handleMcpRequest } from "@/lib/mcp/server";

/**
 * The HelixOS MCP server (rev 224): Streamable HTTP, stateless, one call per request. POST carries the JSON-RPC message;
 * there is no server-to-client stream to open (GET) or session to end (DELETE), and the client falls back as the spec allows.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function GET() {
  return new Response(JSON.stringify({ error: "method_not_allowed", error_description: "this server is stateless: POST each message" }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
