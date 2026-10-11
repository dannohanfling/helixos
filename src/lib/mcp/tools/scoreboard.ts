/**
 * "Read me my scoreboard" (rev 642): the same Monday scoreboard the email carries, read aloud, for last week or this week so
 * far. For the coach it is the roster of their clients' week, names only (rev 639). Read-only; no Body number is ever in it.
 */
import { z } from "zod";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { rosterFor, scoreboardFor } from "@/lib/scoreboard";
import { scoreboardSpoken } from "@/lib/engine/scoreboard";

defineTool({
  name: "scoreboard_read",
  scope: "today",
  kind: "read",
  description: "The member's weekly scoreboard, as the Monday email has it: posts shipped by channel, comments and clients added they logged, DMs, calls, days closed, their 3-1-3, and their key results and KPIs. Last week unless asked for this week so far. For a coach, the roster: one line per active client, names only. Read the first sentence, then the rest if asked.",
  input: { week: z.enum(["last", "this"]).optional().describe("last (the default) or this week so far") },
  handler: async (v, input): Promise<ToolResult> => {
    const which = input.week === "this" ? "this" : "last";
    if (v.role === "coach" && !v.switchedInto) {
      const r = await rosterFor(v.workspace.id);
      if (!r.lines.length) return { text: "No active clients to report on.", data: { roster: [] } };
      return { text: `Your clients' last week, ${r.lines.length} of them:\n${r.lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`, data: { week: r.week, roster: r.lines } };
    }
    const s = await scoreboardFor({ workspaceId: v.workspace.id, userId: v.user.id }, v.tz, v.today, which);
    return { text: scoreboardSpoken(s, which === "last" ? "Last week" : "This week so far"), data: s };
  },
});
