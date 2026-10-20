import { describe, expect, it } from "vitest";
import { FRAMEWORKS_MD, FRAMEWORKS_MD_V2 } from "../../../../scripts/fixtures/frameworks";
import { frameworkBlock, frameworkPost, frameworkReel, frameworkTraining, rankFrameworks, readFrameworks, readSteps, slugOf } from "@/lib/engine/frameworks";
import { libraryBlock, usedIds } from "@/lib/engine/teaching";

describe("frameworks (H-1262): the reader", () => {
  const read = readFrameworks(FRAMEWORKS_MD);
  it("reads three frameworks and names the one it can't", () => {
    expect(read.entries.map((e) => e.slug)).toEqual(["belief-before-the-call", "the-opener", "the-price-ladder"]);
    expect(read.unreadable).toEqual(["A heading with nothing under it"]);
  });
  it("reads every field, the steps in order, the source and the credit", () => {
    const b = read.entries[0];
    expect(b).toMatchObject({ name: "Belief Before the Call", pillar: "Belief", rank: "Sentinel", contentAngles: "ladder, reel", evolution: "v2, the morning question added in September", rawStatus: "keep", borrowedFrom: null, hasPrice: false });
    expect(b.idea).toMatch(/^People do not show up sold/);
    expect(b.steps).toHaveLength(3);
    expect(b.steps[0]).toBe("Confirm the call the same day with one line about what they will leave with.");
    expect(b.mistakes).toMatch(/A reminder with no belief in it is a bill/);
    expect(b.exactWords).toBe('"They don\'t show up sold. They show up warmed."');
    expect(b).toMatchObject({ sourceCall: "Accelerator call", sourceDate: "2026-09-04", fathomUrl: "https://fathom.video/share/walk-framework?timestamp=612" });
    const o = read.entries[1];
    expect(o.steps).toEqual(["Ask what made them book, in their words.", "Repeat the problem back in one sentence and wait.", "Only then ask what it costs them to leave it."]);
    expect(o.borrowedFrom).toBe("NEPQ, Jeremy Miner");
  });
  it("flags a price anywhere, and never guesses a status", () => {
    expect(read.entries[2].hasPrice).toBe(true);
    expect(read.entries.map((e) => e.rawStatus)).toEqual(["keep", null, null]);
  });
  it("the digest changes only when a field does", () => {
    const v2 = readFrameworks(FRAMEWORKS_MD_V2);
    expect(v2.entries[0].digest).not.toBe(read.entries[0].digest);
    expect(v2.entries[1].digest).toBe(read.entries[1].digest);
  });
  it("reads steps as a numbered list, bullets, lines, or one line", () => {
    expect(readSteps("1. A\n2. B")).toEqual(["A", "B"]);
    expect(readSteps("- A\n- B")).toEqual(["A", "B"]);
    expect(readSteps("A\nB")).toEqual(["A", "B"]);
    expect(readSteps("1) Ask. 2) Listen.")).toEqual(["Ask.", "Listen."]);
    expect(readSteps("")).toEqual([]);
  });
  it("a slug is the name in dashes, at most 80 long, never empty for a real name", () => {
    expect(slugOf("Belief Before the Call")).toBe("belief-before-the-call");
    expect(slugOf("  Café, Résumé & Co.!  ")).toBe("cafe-resume-co");
    expect(slugOf("x".repeat(100)).length).toBe(80);
    expect(slugOf("???")).toBe("");
  });
});

describe("frameworks: content and the writer", () => {
  const f = readFrameworks(FRAMEWORKS_MD).entries[0];
  const o = readFrameworks(FRAMEWORKS_MD).entries[1];
  it("the post carries the steps in order, the quote and the name; the credit when borrowed", () => {
    const post = frameworkPost(f, "Danno");
    expect(post.indexOf("1. Confirm the call")).toBeLessThan(post.indexOf("2. Send one short story"));
    expect(post).toContain('"They don\'t show up sold. They show up warmed."');
    expect(post).toContain("This is Belief Before the Call, one of the frameworks I teach.");
    expect(frameworkPost(o)).toContain("(after NEPQ, Jeremy Miner)");
  });
  it("the reel has five beats with the steps in the middle; the training five lines", () => {
    const reel = frameworkReel(f);
    expect(reel.split("\n\n")).toHaveLength(5);
    expect(reel).toMatch(/THE STEPS \(12–45s\): 1\) Confirm the call/);
    expect(frameworkTraining(f).split("\n")).toHaveLength(5);
    expect(frameworkTraining(f)).toContain("3) Ask one question on the morning");
  });
  it("ranks by shared words, fresh before used, at most four, none with no shared word", () => {
    const rows = [
      { id: "a", name: "Belief Before the Call", idea: "warm the call", steps: ["confirm the call"], whenToUse: null, pillar: "Belief" },
      { id: "b", name: "The Opener", idea: "first question", steps: ["ask what made them book"], whenToUse: null, pillar: "Conversations" },
      { id: "c", name: "Unrelated", idea: "nothing here", steps: ["none"], whenToUse: null, pillar: null },
    ];
    expect(rankFrameworks(rows, ["call", "booked", "question"], new Set()).map((r) => r.id)).toEqual(["a", "b"]);
    expect(rankFrameworks(rows, ["call", "question"], new Set(["a"])).map((r) => r.id)).toEqual(["b", "a"]);
    expect(rankFrameworks(rows, [], new Set())).toEqual([]);
    expect(rankFrameworks([rows[0], rows[0], rows[0], rows[0], rows[0]], ["call"], new Set())).toHaveLength(4);
  });
  it("the block tags frameworks F1…, the library block carries them, and the writer's F ids are read back", () => {
    const block = frameworkBlock([f, o]);
    expect(block[0]).toMatch(/^\[F1\] Framework: Belief Before the Call\nIdea: /);
    expect(block[1]).toMatch(/^\[F2\] Framework: The Opener \(after NEPQ, Jeremy Miner\)/);
    expect(block[0]).toContain("Steps: 1) Confirm the call");
    const lib = libraryBlock([], [], block);
    expect(lib).toContain("AND FRAMEWORKS");
    expect(lib).toContain("[F2]");
    expect(usedIds("T2, S1, F1, f9")).toEqual(["T2", "S1", "F1", "F9"]);
    expect(libraryBlock([], [], [])).toBe("");
  });
});
