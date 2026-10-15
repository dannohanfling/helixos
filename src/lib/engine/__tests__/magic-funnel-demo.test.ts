import { describe, expect, it } from "vitest";
import { fallbackInWords, fixPillars, pillarIdOf, pillarShape, previewPath, quoteShort, resolvePillarOrder, type MfPitch } from "@/lib/engine/magic-funnel";
import { quoteOnce } from "@/lib/hermes/rules";

const pillars = [
  { id: "p1", title: "Posts that start conversations" },
  { id: "p2", title: "The three-message close" },
  { id: "p3", title: "Calls that book themselves" },
];

describe("the pillars as the writer names them (H-142)", () => {
  it("ids in any case, the titles, Pillar N, N, and an id with its title all resolve", () => {
    expect(resolvePillarOrder(["p2", "p3", "p1"], pillars)).toEqual(["p2", "p3", "p1"]);
    expect(resolvePillarOrder(["P2", " p3 ", "P1"], pillars)).toEqual(["p2", "p3", "p1"]);
    expect(resolvePillarOrder(["The three-message close", "Calls that book themselves", "Posts that start conversations"], pillars)).toEqual(["p2", "p3", "p1"]);
    expect(resolvePillarOrder(["Pillar 2", "pillar 3", "Pillar 1"], pillars)).toEqual(["p2", "p3", "p1"]);
    expect(resolvePillarOrder(["2", "3", "1"], pillars)).toEqual(["p2", "p3", "p1"]);
    expect(resolvePillarOrder(["p2: The three-message close", "p3 - Calls that book themselves", "p1 Posts that start conversations"], pillars)).toEqual(["p2", "p3", "p1"]);
    expect(pillarIdOf("THE THREE MESSAGE CLOSE", pillars)).toBe("p2");
  });
  it("two of three, a repeat, a stranger and an empty list stay unresolved", () => {
    expect(resolvePillarOrder(["p1", "p2"], pillars)).toBeNull();
    expect(resolvePillarOrder(["p1", "p1", "p2"], pillars)).toBeNull();
    expect(resolvePillarOrder(["p1", "p2", "p9"], pillars)).toBeNull();
    expect(resolvePillarOrder(["Pillar 1", "Pillar 2", "Pillar 4"], pillars)).toBeNull();
    expect(resolvePillarOrder([], pillars)).toBeNull();
    expect(resolvePillarOrder(["p1"], [])).toBeNull();
  });
  it("fixPillars keys the order and the lines by id, and leaves an unresolvable order as it was", () => {
    const base = { pillars: { order: ["The three-message close", "Calls that book themselves", "Posts that start conversations"], lines: { "The three-message close": "a", "Calls that book themselves": "b", "Posts that start conversations": "c" } } } as unknown as MfPitch;
    const fixed = fixPillars(base, pillars);
    expect(fixed.pillars.order).toEqual(["p2", "p3", "p1"]);
    expect(fixed.pillars.lines.p2).toBe("a");
    expect(fixed.pillars.lines.p1).toBe("c");
    const odd = { pillars: { order: ["x", "y", "z"], lines: {} } } as unknown as MfPitch;
    expect(fixPillars(odd, pillars).pillars.order).toEqual(["x", "y", "z"]);
  });
  it("the log shape says the kinds and the count, never the words", () => {
    expect(pillarShape(["p1", "The three-message close", "Pillar 3", "something else"], pillars)).toEqual({ n: 4, kinds: ["id", "title", "number", "other"] });
    expect(JSON.stringify(pillarShape(["something else"], pillars))).not.toContain("something");
  });
});

describe("fallbacks in words (H-142)", () => {
  it("every engine reason reads as one plain sentence for the coach", () => {
    expect(fallbackInWords("pillars out of order")).toBe("the writer named the three pillars in a way the page couldn't match");
    expect(fallbackInWords("a number that isn't in the facts")).toMatch(/isn't in the webinar facts/);
    expect(fallbackInWords("writer: cut at 2000 tokens")).toBe("the writer gave nothing usable (cut at 2000 tokens)");
    expect(fallbackInWords("something new")).toBe("the writer's version didn't pass the check (something new)");
  });
});

describe("proof lines (H-142)", () => {
  it("quoteShort cuts at the last sentence end before the limit, else at a word, never mid-word, and leaves a short quote whole", () => {
    const q = "In the last six weeks I booked nine calls from one post. Then I stopped chasing people and then get the guy who said no last year.";
    expect(quoteShort(q, 140)).toBe(q);
    expect(quoteShort(q, 100)).toBe("In the last six weeks I booked nine calls from one post.");
    expect(quoteShort(q, 60)).toBe("In the last six weeks I booked nine calls from one post.");
    const run = "This one long sentence never ends because the person kept talking about their business and what changed for them over the year";
    const cut = quoteShort(run, 50);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(51);
    expect(run.startsWith(cut.slice(0, -1))).toBe(true);
    expect(run.charAt(cut.length - 1)).toBe(" ");
    expect(quoteShort("Short and sweet.", 140)).toBe("Short and sweet.");
    expect(quoteShort("  spaced   out  ", 140)).toBe("spaced out");
  });
  it("quoteOnce strips the initial forms of the name a Proof Bank entry carries, so the name shows once", () => {
    expect(quoteOnce("Kim Y.: In the last six weeks I booked nine calls.", "Kim Yates")).toBe("In the last six weeks I booked nine calls.");
    expect(quoteOnce("K. Yates: It works.", "Kim Yates")).toBe("It works.");
    expect(quoteOnce("It works. — Kim Y.", "Kim Yates")).toBe("It works.");
    expect(quoteOnce("Kim Y.: It works.", "Kim Y.")).toBe("It works.");
    expect(quoteOnce("Kimberly said it works.", "Kim Yates")).toBe("Kimberly said it works.");
  });
  it("a preview opens at /mf/p/<code>", () => {
    expect(previewPath("abc")).toBe("/mf/p/abc");
  });
});
