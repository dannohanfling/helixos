import { describe, expect, it, vi } from "vitest";

// H-561: whoami names the agent on an agent's own token. The database read is stubbed.
const findFirst = vi.fn();
vi.mock("@/db", async (orig) => {
  const real = await orig<typeof import("@/db")>();
  return { ...real, db: { query: { forumAgents: { findFirst } } } };
});

const { whoami } = await import("@/lib/mcp/tools/whoami");

const v = { user: { id: "u1", name: "Coach" }, role: "coach", workspace: { id: "w1", name: "Studio" }, today: "2026-10-17", tz: "America/Los_Angeles" } as never;

describe("whoami (H-561)", () => {
  it("says nothing about an agent on a member's own connection", async () => {
    findFirst.mockReset();
    const r = await whoami.handler(v, {}, { scopes: ["tasks"] } as never);
    expect(findFirst).not.toHaveBeenCalled();
    expect(r.text).toMatch(/^Connected as Coach \(coach\) in Studio\./);
    expect(r.data).not.toHaveProperty("agent");
  });

  it("names the agent and its building on an agent token", async () => {
    findFirst.mockReset().mockResolvedValue({ name: "Viator", plotId: "nowhere" });
    const r = await whoami.handler(v, {}, { scopes: ["tasks"], agentId: "a1" } as never);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(r.text).toMatch(/^Agent: Viator \(the Outer districts\)\. Connected as Coach/);
    expect(r.data).toMatchObject({ agent: "Viator", building: "the Outer districts" });
  });

  it("falls back to the plain line when the agent is not this owner's", async () => {
    findFirst.mockReset().mockResolvedValue(undefined);
    const r = await whoami.handler(v, {}, { scopes: [], agentId: "a2" } as never);
    expect(r.text).toMatch(/^Connected as Coach/);
    expect(r.text).toMatch(/Allowed: nothing yet\.$/);
  });
});
