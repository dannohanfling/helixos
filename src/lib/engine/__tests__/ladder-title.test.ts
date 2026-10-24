import { describe, expect, it } from "vitest";
import { ladderTitle, parseLadderOutput, scaffold } from "../ladder";

describe("ladderTitle (H-1941)", () => {
  it("takes off SKIN and the format name", () => {
    expect(ladderTitle("SKIN — Method / Resource — The $1,000 first-gear offer")).toBe("The $1,000 first-gear offer");
    expect(ladderTitle("SKIN – Origin Story – Flyers on poles")).toBe("Flyers on poles");
    expect(ladderTitle("skin - Mistakes Ladder - quit by week three")).toBe("quit by week three");
  });
  it("takes off SKIN alone, or the format name alone", () => {
    expect(ladderTitle("SKIN — make peace with your past")).toBe("make peace with your past");
    expect(ladderTitle("Method / Resource — five free moves")).toBe("five free moves");
  });
  it("leaves a plain topic, and a topic that only contains a dash, as written", () => {
    expect(ladderTitle("The $1,000 first-gear offer")).toBe("The $1,000 first-gear offer");
    expect(ladderTitle("Before — and after the launch")).toBe("Before — and after the launch");
    expect(ladderTitle("SKIN-care routines for coaches")).toBe("SKIN-care routines for coaches");
    expect(ladderTitle("Roadmapping — a week of days")).toBe("Roadmapping — a week of days");
  });
  it("falls back to the topic when nothing is left", () => {
    expect(ladderTitle("", "the topic")).toBe("the topic");
    expect(ladderTitle("SKIN — Roadmap — ", "the topic")).toBe("the topic");
    expect(ladderTitle(null, "the topic")).toBe("the topic");
  });
  it("new ladders are saved plain, from the writer and from the skeleton", () => {
    expect(parseLadderOutput("POST_NAME:\nSKIN — Tool Stack — five tools under $50\nHEADLINE:\nX / Y (gold: Y)").postName).toBe("five tools under $50");
    expect(scaffold({ format: "tool_stack", topic: "Five tools under $50 that run my week", audience: "warm", keyword: "NONE" }, null, []).postName).toBe("Five tools under $50 that run my week");
    expect(parseLadderOutput("POST_NAME:\nfive tools under $50\nHEADLINE:\nX / Y (gold: Y)").postName).toBe("five tools under $50");
  });
});
