import { describe, expect, it } from "vitest";
import { AGENT_OWN_SCOPES, CLIENT_SCOPES, SEND_SCOPES, SEND_TOOLS, changeWords, isAgentOwnScope, noGrantRefusal, notSwitchedRefusal, sendRefusal, switchedLine, viewOnlyRefusal } from "@/lib/engine/agent-clients";
import { MCP_SCOPES } from "@/db/schema";

describe("an agent in a client's HelixOS (H-1385): the words and the rules", () => {
  it("the agent's own tools stay the agent's; the client tools are everything but HumanOS, the own scopes and the Partner Program", () => {
    expect([...AGENT_OWN_SCOPES]).toEqual(["forum", "inbox", "clients", "partner"]);
    expect(isAgentOwnScope("partner")).toBe(true);
    expect(isAgentOwnScope(null)).toBe(true);
    expect(isAgentOwnScope("inbox")).toBe(true);
    expect(isAgentOwnScope("tasks")).toBe(false);
    expect(CLIENT_SCOPES).not.toContain("body");
    expect(CLIENT_SCOPES).not.toContain("inbox");
    expect(CLIENT_SCOPES).not.toContain("clients");
    for (const s of ["today", "tasks", "essence", "content", "dms"]) expect(CLIENT_SCOPES).toContain(s);
    expect(new Set([...CLIENT_SCOPES, ...AGENT_OWN_SCOPES, "body", "partner"]).size).toBe(MCP_SCOPES.length);
  });

  it("sends are refused by scope and by name, with the inbox as the way", () => {
    expect([...SEND_SCOPES]).toEqual(["content:publish", "dms", "office_hours"]);
    expect(SEND_TOOLS.has("ladder_ship")).toBe(true);
    expect(SEND_TOOLS.has("dm_log")).toBe(true);
    expect(sendRefusal("Maya")).toMatch(/sends or publishes as Maya/);
    expect(sendRefusal("Maya")).toMatch(/Danno's inbox/);
  });

  it("the lines say whose HelixOS and which mode, and why a call was refused", () => {
    expect(switchedLine("Maya", "work")).toBe("Working in Maya's HelixOS: changes are logged for them.");
    expect(switchedLine("Maya", "view")).toMatch(/^Viewing Maya's HelixOS/);
    expect(viewOnlyRefusal("Maya")).toMatch(/coach-work switch is off/);
    expect(noGrantRefusal("Maya")).toMatch(/access to Maya's HelixOS has ended/);
    expect(noGrantRefusal(null)).toMatch(/no client it may work in/);
    expect(notSwitchedRefusal()).toMatch(/client_switch/);
  });

  it("a write reads in the client's record in words, and an unknown tool by its name", () => {
    expect(changeWords("tasks_add")).toEqual({ action: "Added a task", page: "Today" });
    expect(changeWords("avatar_update")).toEqual({ action: "Updated an avatar", page: "Avatars" });
    expect(changeWords("some_new_tool")).toEqual({ action: "Made a change with some_new_tool", page: "the connector" });
  });
});
