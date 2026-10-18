import { describe, expect, it, vi } from "vitest";

// H-591: the report tools are listed only on the coach's own connection. The database is never reached here.
vi.mock("@/db", async (orig) => {
  const real = await orig<typeof import("@/db")>();
  return { ...real, db: {} };
});

await import("@/lib/mcp/tools/reports");
const { toolsFor } = await import("@/lib/mcp/registry");

const REPORT_TOOLS = ["reports_list", "report_read", "report_mark"];
const coach = { role: "coach" as const, switchedInto: null, team: null };
const names = (caller?: Parameters<typeof toolsFor>[1]) => toolsFor(["inbox", "forum"], caller).map((t) => t.name).filter((n) => REPORT_TOOLS.includes(n));

describe("report tools on the connector (H-591)", () => {
  it("are listed for the coach's own connection", () => {
    expect(names({ agentToken: false, viewer: coach }).sort()).toEqual([...REPORT_TOOLS].sort());
  });
  it("are hidden from an agent token, a client, a switched coach, a team member, and a caller nobody named", () => {
    expect(names({ agentToken: true, viewer: coach })).toEqual([]);
    expect(names({ agentToken: false, viewer: { ...coach, role: "client" } })).toEqual([]);
    expect(names({ agentToken: false, viewer: { ...coach, switchedInto: { id: "m" } as never } })).toEqual([]);
    expect(names({ agentToken: false, viewer: { ...coach, team: { id: "t" } as never } })).toEqual([]);
    expect(names()).toEqual([]);
  });
  it("need the inbox access the coach's connection already has", () => {
    expect(toolsFor(["forum"], { agentToken: false, viewer: coach }).map((t) => t.name).filter((n) => REPORT_TOOLS.includes(n))).toEqual([]);
  });
});
