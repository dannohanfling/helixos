import { handleBotMcpRequest } from "@/lib/bot-mcp/server";

/**
 * Bot connection (rev 696): the small MCP server a member's Community Loyalty bot calls mid-conversation. Streamable HTTP,
 * stateless, one message per POST, with the member's bot key as the Bearer token. Never the member connector (/api/mcp).
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleBotMcpRequest(request);
}

export async function GET() {
  return new Response(JSON.stringify({ error: "method_not_allowed", error_description: "this server is stateless: POST each message" }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
