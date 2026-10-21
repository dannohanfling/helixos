import { defineScope, defineTool } from "@/lib/mcp/registry";
import { canAiUseBody } from "@/lib/queries/body";
import { SCOPE_WORDS } from "@/lib/engine/mcp";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { FORUM_BUILDINGS, isForumPlot } from "@/lib/engine/forum";
import { switchedLine } from "@/lib/engine/agent-clients";

/** Body's scope gate (rev 247, B6): Body's own AI switch, read live on every call. Body's tools register against this scope. */
defineScope("body", { gate: (v) => canAiUseBody(v, v.user.id) });

/** The one tool every grant has: who the token acts as, so Claude can say "connected as Maya" and knows the date. */
export const whoami = defineTool({
  name: "whoami",
  scope: null,
  kind: "read",
  description: "Who this HelixOS connection acts as: name, role (coach or client), workspace, today's date in their timezone, and the scopes granted. On an agent's own token it also names the agent and its Forum building, so an agent can check it is on its own token.",
  input: {},
  handler: async (v, _input, call) => {
    // H-561: an agent token says which agent it is, so a session can prove it isn't on another agent's token.
    const agent = call?.agentId ? await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.id, call.agentId), eq(schema.forumAgents.workspaceId, v.workspace.id), eq(schema.forumAgents.userId, v.user.id)), columns: { name: true, plotId: true } }) : null;
    const building = agent ? (isForumPlot(agent.plotId) ? FORUM_BUILDINGS[agent.plotId].place : "the Outer districts") : null;
    // H-1385: inside a client's HelixOS the agent says whose, and whether it is working or only viewing.
    const sw = call?.switched?.switchedInto ?? null;
    const inside = sw ? { client: call!.switched!.user.name, clientMembershipId: sw.membershipId, mode: sw.mode } : null;
    const data = { name: v.user.name, role: v.role, workspace: v.workspace.name, today: v.today, timezone: v.tz, scopes: [...(call?.scopes ?? [])], ...(agent ? { agent: agent.name, building } : {}), ...(inside ? { inside } : {}) };
    return { text: `${agent ? `Agent: ${agent.name} (${building}). ` : ""}${inside ? `${switchedLine(inside.client.split(" ")[0], inside.mode)} ` : ""}Connected as ${v.user.name} (${v.role}) in ${v.workspace.name}. Today is ${v.today} (${v.tz}). Allowed: ${(call?.scopes ?? []).map((s) => SCOPE_WORDS[s].label).join(", ") || "nothing yet"}.`, data };
  },
});
