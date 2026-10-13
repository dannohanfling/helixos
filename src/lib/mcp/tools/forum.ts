/**
 * The Forum on the connector (rev 765 §2): forum_report, for any agent that can use a connector, and forum_read, so an agent
 * can see what the others are doing. Both act only on the caller's own Forum. A report is the same as one through the
 * member's webhook: same fields, same caps, same secret scrub, same 60-a-minute limit.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { forumStateFor, reportToForum } from "@/lib/forum";
import { FORUM_BUILDINGS, FORUM_MAX } from "@/lib/engine/forum";

const line = (what: string) => z.string().max(2000).optional().describe(`${what}, up to ${FORUM_MAX.line} characters; send "" to clear it`);

defineTool({
  name: "forum_report",
  scope: "forum",
  kind: "write",
  description:
    "Report what an AI agent is doing to the member's Forum, the live map of their agents. Name the agent (it's added, marked new, if the name is new) and send any of: status (working, waiting, idle or done), now, last and next (one line each), a flow to another agent or to \"you\" (the member) with a short label, needs_you when the member has to do something, needs_cleared when that's done, queue (the agent's milestones), and a one-line headline for the whole Forum. Times are UTC. Never send keys, tokens or passwords: anything that looks like one is removed.",
  input: {
    agent: z.string().min(1).max(100).describe("The agent's name, as it shows on the Forum, e.g. \"Main\""),
    status: z.enum(["working", "waiting", "idle", "done"]).optional(),
    now: line("What it's doing now"),
    last: line("What it did last"),
    next: line("What it'll do next"),
    flow: z.object({ to: z.string().max(100).describe("Another agent's name, or \"you\" for the member"), label: z.string().max(200).optional().describe("A few words, e.g. \"plan for 765\"") }).optional(),
    needs_you: z.object({ what: z.string().max(500), detail: z.string().max(2000).optional(), when: z.string().max(200).optional().describe("When it's needed, in words: \"today\", \"before Friday\"") }).optional(),
    needs_cleared: z.union([z.literal(true), z.array(z.string().max(500)).max(20)]).optional().describe("true clears all of this agent's items on What needs you; a list clears those by their \"what\""),
    queue: z.array(z.object({ name: z.string().max(200), state: z.enum(["done", "now", "queued"]).optional(), rev: z.string().max(40).optional() })).max(20).optional(),
    headline: z.string().max(500).optional().describe("One line for the top of the Forum"),
    at: z.string().max(40).optional().describe("When this happened, as a UTC time (2026-10-12T05:35:00Z); leave out to use now"),
  },
  handler: async (v, input, call): Promise<ToolResult> => {
    // A connection that speaks as one agent (rev 769) reports as that agent, whatever name it sends.
    const own = call?.agentId ? await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, v.workspace.id), eq(schema.forumAgents.userId, v.user.id), eq(schema.forumAgents.id, call.agentId)), columns: { name: true } }) : null;
    const r = await reportToForum({ workspaceId: v.workspace.id, userId: v.user.id }, own ? { ...input, agent: own.name } : input, "connector");
    if (!r.ok) throw new Error(r.text);
    return { text: r.text, data: { agent_id: r.agentId, agent: r.agent, created: r.created, removed: r.removed } };
  },
});

defineTool({
  name: "forum_read",
  scope: "forum",
  kind: "read",
  description: "Read the member's Forum: each agent's status, now, last and next, the messages on the streets, the road, what's waiting on the member, and the latest news. Times are UTC.",
  input: {},
  handler: async (v): Promise<ToolResult> => {
    const s = await forumStateFor({ workspaceId: v.workspace.id, userId: v.user.id });
    if (!s.agents.length) return { text: "The Forum is empty: no agent has reported yet.", data: s };
    const lines = s.agents.map((a) => `${a.name} (${a.plot ? FORUM_BUILDINGS[a.plot].place : "in the Outer districts"}): ${a.status}${a.now ? `, now: ${a.now}` : ""}`);
    return { text: `${s.headline ? `${s.headline}\n` : ""}${lines.join("\n")}${s.waiting.length ? `\nWaiting on the member: ${s.waiting.length}.` : ""}`, data: s };
  },
});
