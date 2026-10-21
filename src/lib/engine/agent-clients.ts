/**
 * An agent in a client's HelixOS (H-1385, plan H-1389): the pure words and rules. The data side is src/lib/agent-clients.ts;
 * the MCP side picks the viewer per tool in src/lib/mcp/server.ts.
 */
import { MCP_SCOPES } from "@/db/schema";
import type { Scope } from "@/lib/engine/mcp";

/**
 * The client tools a granted agent token carries (H-1385): everything but HumanOS, the agent's own scopes and the Partner
 * Program. They are listed always, so an MCP client's cached tool list holds, and run only while switched into a client.
 */
export const CLIENT_SCOPES: readonly Scope[] = MCP_SCOPES.filter((s) => !["body", "forum", "inbox", "clients", "partner"].includes(s));
export function notSwitchedRefusal(): string {
  return "Not in a client's HelixOS: this tool acts as a client, so call client_switch with the client's first name first.";
}
/** The agent's own tools, which keep acting as the agent itself (through the coach's own viewer) while it is switched in. */
export const AGENT_OWN_SCOPES: readonly Scope[] = ["forum", "inbox", "clients"];
export const isAgentOwnScope = (scope: Scope | null): boolean => scope === null || AGENT_OWN_SCOPES.includes(scope);

/**
 * Never from inside a client's HelixOS, even when granted (H-1385 §5): anything that sends to the client's contacts or
 * members, or publishes as them. By scope, so a new tool in one of these is covered on arrival.
 */
export const SEND_SCOPES: readonly Scope[] = ["content:publish", "dms", "office_hours"];
export const SEND_TOOLS: ReadonlySet<string> = new Set(["ladder_ship", "ladder_ship_preview", "dm_log", "office_hours_submit", "push_to_instacart_cart"]);

export function sendRefusal(first: string): string {
  return `That sends or publishes as ${first}, which an agent never does from their HelixOS. Post it to Danno's inbox for approval instead.`;
}
export function viewOnlyRefusal(first: string): string {
  return `You're viewing ${first}'s HelixOS: their coach-work switch is off, so nothing can be changed. Reads still work.`;
}
export function noGrantRefusal(first: string | null): string {
  return first ? `Your access to ${first}'s HelixOS has ended: the coach stopped it on their client page.` : "This agent has no client it may work in. The coach grants it per client on the client's page.";
}

/** The whoami line for a switched agent. */
export function switchedLine(first: string, mode: "view" | "work"): string {
  return mode === "work" ? `Working in ${first}'s HelixOS: changes are logged for them.` : `Viewing ${first}'s HelixOS: their coach-work switch is off, so reads only.`;
}

/** What a tool call reads as in the client's Changes by your coach: known tools in words, the rest named plainly. */
const TOOL_WORDS: Record<string, { action: string; page: string }> = {
  tasks_add: { action: "Added a task", page: "Today" },
  tasks_complete: { action: "Completed a task", page: "Today" },
  tasks_uncomplete: { action: "Reopened a task", page: "Today" },
  tasks_reschedule: { action: "Moved a task", page: "Today" },
  today_lock_in: { action: "Locked in the day", page: "Today" },
  today_lockin: { action: "Locked in the day", page: "Today" },
  today_close: { action: "Closed the day", page: "Today" },
  idea_add: { action: "Added an idea", page: "Ideas" },
  proof_add: { action: "Saved a proof draft", page: "Proof Bank" },
  avatar_add: { action: "Added an avatar", page: "Avatars" },
  avatar_update: { action: "Updated an avatar", page: "Avatars" },
  avatar_interview_start: { action: "Started an avatar interview", page: "Avatars" },
  avatar_interview_answer: { action: "Answered an avatar interview", page: "Avatars" },
  offer_link_avatar: { action: "Linked an avatar to an offer", page: "Offers" },
  ladder_create: { action: "Created a ladder", page: "Ladders" },
  ladder_update: { action: "Updated a ladder", page: "Ladders" },
  ladder_make_graphic: { action: "Made a ladder graphic", page: "Ladders" },
  action_step_to_task: { action: "Turned an action step into a task", page: "Recordings" },
  board_apply: { action: "Applied the Board's setup", page: "My Board" },
  board_ask: { action: "Asked the Board", page: "My Board" },
  board_checkin: { action: "Checked in with the Board", page: "My Board" },
  webinar_readiness: { action: "Checked a webinar's readiness", page: "Webinars" },
  report_mark: { action: "Marked a report", page: "Issues and ideas" },
};
export function changeWords(tool: string): { action: string; page: string } {
  return TOOL_WORDS[tool] ?? { action: `Made a change with ${tool}`, page: "the connector" };
}
