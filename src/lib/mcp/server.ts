/**
 * The MCP route's brain (rev 224): one request, one call, nothing in memory (Vercel gives no shared memory between
 * requests, so the transport runs stateless). The bearer token names the member; the grant's scopes pick the tools listed;
 * every call rechecks the scope, runs the scope's gate, keeps within the rate limits, runs the handler, and writes an audit
 * row with the tool and the outcome, never the arguments.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { allow } from "@/lib/rate-limit";
import { APP_VERSION } from "@/lib/version";
import { authenticateBearer, issuer, type Grant } from "@/lib/mcp/oauth";
import { gateFor, toolsFor, type ToolDef } from "@/lib/mcp/registry";
import "@/lib/mcp/tools";

/** Per grant: a minute's and a day's worth, the way the plan set them. */
export const PER_MINUTE = 60;
export const PER_DAY = 2000;

function unauthorized(request: Request, why: string): Response {
  const iss = issuer(request);
  // The MCP authorization spec: the client learns where to authorize from this header.
  return new Response(JSON.stringify({ error: "invalid_token", error_description: why }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": `Bearer realm="HelixOS", resource_metadata="${iss}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${why}"` } });
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/** One tool call: the gate, the handler, the audit row, in the app's own plain words on failure. */
async function run(grant: Grant, def: ToolDef, args: Record<string, unknown>) {
  const t0 = Date.now();
  let ok = true;
  let error: string | null = null;
  let text = "";
  try {
    const gate = def.scope ? gateFor(def.scope) : undefined;
    if (gate && !(await gate(grant.viewer))) {
      ok = false;
      error = "gate";
      text = def.scope === "body" ? "HumanOS's AI switch is off for this member, so HumanOS tools do nothing. They can turn it on in HumanOS settings." : "This tool isn't available for this member right now.";
    } else {
      const r = await def.handler(grant.viewer, args, { scopes: grant.scopes });
      text = r.data === undefined ? r.text : `${r.text}\n\n${JSON.stringify(r.data, null, 2)}`;
    }
  } catch (e) {
    ok = false;
    error = e instanceof Error ? e.message.slice(0, 200) : "error";
    text = e instanceof Error ? e.message : "Something went wrong.";
  }
  const ms = Date.now() - t0;
  await db.insert(schema.mcpCalls).values({ id: newId(), workspaceId: grant.viewer.workspace.id, userId: grant.viewer.user.id, appId: grant.app.id, tool: def.name, ok, error, ms });
  await db.update(schema.connectedApps).set({ lastUsedAt: nowIso(), lastTool: def.name }).where(eq(schema.connectedApps.id, grant.app.id));
  return textResult(text, !ok);
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return unauthorized(request, "a bearer token is required");
  const grant = await authenticateBearer(token);
  if (!grant) return unauthorized(request, "the token is not valid, or the connection was disconnected");
  const [minute, day] = await Promise.all([allow(`mcp:min:${grant.app.id}`, PER_MINUTE, 60_000), allow(`mcp:day:${grant.app.id}`, PER_DAY, 24 * 60 * 60 * 1000)]);
  if (!minute || !day) return new Response(JSON.stringify({ error: "rate_limited", error_description: `at most ${PER_MINUTE} calls a minute and ${PER_DAY} a day per connection` }), { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } });

  const server = new McpServer({ name: "HelixOS", version: APP_VERSION });
  for (const def of toolsFor(grant.scopes)) {
    server.registerTool(def.name, { description: def.description, inputSchema: def.input, annotations: { readOnlyHint: def.kind === "read", destructiveHint: false, openWorldHint: false } }, (args) => run(grant, def, (args ?? {}) as Record<string, unknown>));
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { authInfo: { token: "", clientId: grant.app.clientId, scopes: grant.scopes } });
  } finally {
    await transport.close().catch(() => undefined);
  }
}
