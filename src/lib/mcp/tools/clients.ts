/**
 * An agent in a client's HelixOS (H-1385, plan H-1389): client_switch and client_switch_off, on an agent token the coach
 * granted at least one client. Once switched, every client tool the token has acts as that client the way the coach's own
 * Switch to client does (src/lib/mcp/server.ts picks the viewer per tool); the agent's own tools keep acting as the agent.
 * Work only while the client lets their coach work in their HelixOS, view otherwise; never HumanOS, never a send.
 */
import { z } from "zod";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { clientByRef, liveGrant, liveGrantsOf, switchInto, switchOut } from "@/lib/agent-clients";
import { noGrantRefusal, switchedLine } from "@/lib/engine/agent-clients";

defineTool({
  name: "client_switch",
  scope: "clients",
  kind: "write",
  description: "Switch into a client's HelixOS the coach granted this agent (by the client's first name, full name or membership id). From then on the client tools on this token act as that client, work or view as their coach-work switch allows, with every change logged for them. whoami says where you are. client_switch_off comes back out.",
  input: { client: z.string().min(1).max(120).describe("The client's first name, full name or membership id") },
  handler: async (v, input, call): Promise<ToolResult> => {
    if (!call?.agentId || !call.appId) return { text: "Only an agent's own token can switch into a client's HelixOS.", data: null };
    const o = { workspaceId: v.workspace.id, userId: v.user.id };
    const grants = await liveGrantsOf(o, call.agentId);
    if (!grants.length) return { text: noGrantRefusal(null), data: null };
    const client = await clientByRef(o, String(input.client));
    if (!client) return { text: "No client of the coach's matches that; give the first name as it is in HelixOS, or the membership id.", data: null };
    const first = client.user.name.split(" ")[0];
    if (!(await liveGrant(o, call.agentId, client.membership.id))) return { text: `The coach hasn't let this agent work in ${first}'s HelixOS. They grant it on ${first}'s page under Coach → Clients.`, data: { granted: false } };
    if (call.switched) await switchOut(v, call.appId, call.agentId, call.switched);
    const sw = await switchInto(v, call.appId, call.agentId, client.membership.id);
    if (!sw) return { text: noGrantRefusal(first), data: null };
    return { text: `${switchedLine(first, sw.switchedInto!.mode)} Call client_switch_off to come back out.`, data: { client: client.user.name, clientMembershipId: client.membership.id, mode: sw.switchedInto!.mode } };
  },
});

defineTool({
  name: "client_switch_off",
  scope: "clients",
  kind: "write",
  description: "Leave the client's HelixOS: the token's client tools act as the coach again.",
  input: {},
  handler: async (v, _input, call): Promise<ToolResult> => {
    if (!call?.agentId || !call.appId) return { text: "Only an agent's own token switches.", data: null };
    if (!call.switched) return { text: "Not in a client's HelixOS.", data: { switched: false } };
    const name = call.switched.user.name.split(" ")[0];
    await switchOut(v, call.appId, call.agentId, call.switched);
    return { text: `Out of ${name}'s HelixOS; acting as ${v.user.name} again.`, data: { switched: false } };
  },
});
