import { describe, expect, it, vi } from "vitest";

// H-164 §12: the pure parts of tools opening by stage. The database is never reached here.
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), db: {} }));
const { newlyOpen, phaseReached } = await import("@/lib/tools-open");

describe("tools open as a client reaches them", () => {
  it("the phase reached is the next rung's, or the last once every rung is built", () => {
    const phases = Array.from({ length: 10 }, () => ({}));
    expect(phaseReached({ next: { phase: 2 } as never, phases: phases as never })).toBe(2);
    expect(phaseReached({ next: null, phases: phases as never })).toBe(9);
  });
  it("Today names each page opened since it last said so, once, and nothing with Show all tools on", () => {
    expect(newlyOpen({ toolsPhase: 0, toolsAnnounced: 0, showAllTools: false })).toEqual([]);
    expect(newlyOpen({ toolsPhase: 1, toolsAnnounced: 0, showAllTools: false }).map((n) => n.label)).toEqual(["Offers"]);
    expect(newlyOpen({ toolsPhase: 2, toolsAnnounced: 0, showAllTools: false }).map((n) => n.href)).toEqual(["/offers", "/pathway", "/proof", "/goals", "/numbers"]);
    expect(newlyOpen({ toolsPhase: 2, toolsAnnounced: 2, showAllTools: false })).toEqual([]);
    expect(newlyOpen({ toolsPhase: 4, toolsAnnounced: 1, showAllTools: true })).toEqual([]);
  });
});
