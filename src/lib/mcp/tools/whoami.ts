import { defineScope, defineTool } from "@/lib/mcp/registry";
import { canAiUseBody } from "@/lib/queries/body";

/** Body's scope gate (rev 247, B6): Body's own AI switch, read live on every call. Body's tools register against this scope. */
defineScope("body", { gate: (v) => canAiUseBody(v, v.user.id) });

/** The one tool every grant has: who the token acts as, so Claude can say "connected as Maya" and knows the date. */
export const whoami = defineTool({
  name: "whoami",
  scope: null,
  kind: "read",
  description: "Who this HelixOS connection acts as: name, role (coach or client), workspace, today's date in their timezone, and the scopes granted.",
  input: {},
  handler: async (v) => {
    const data = { name: v.user.name, role: v.role, workspace: v.workspace.name, today: v.today, timezone: v.tz };
    return { text: `Connected as ${v.user.name} (${v.role}) in ${v.workspace.name}. Today is ${v.today} (${v.tz}).`, data };
  },
});
