import { describe, expect, it } from "vitest";
import { BLACKLIST, explainFabricated, findFabricated, stripFabricated, stripNote } from "../blacklist";
import { byCitations, fallbackTerms, flagsFor, insertText, queryKey } from "../evidence";
import seed from "@/data/research-library-seed-v2.json";

describe("fabricated-stat blacklist", () => {
  it("every entry compiles, carries a why and a say-instead, and never blocks in silence", () => {
    expect(BLACKLIST.length).toBe(12);
    for (const e of BLACKLIST) {
      expect(() => new RegExp(e.pattern, "i")).not.toThrow();
      expect(e.why.length, e.id).toBeGreaterThan(20);
      expect(e.sayInstead.length, e.id).toBeGreaterThan(5);
    }
  });
  it("matches loosely and case-insensitively, and explains with the why and the say-instead", () => {
    const m = findFabricated("Everyone knows it takes 21 DAYS to form a habit.");
    expect(m.map((x) => x.entry.id)).toEqual(["b02"]);
    const why = explainFabricated(m);
    expect(why).toContain("Psycho-Cybernetics");
    expect(why).toContain("Say instead: Habits take longer than people expect");
    expect(findFabricated("A famous Harvard study on goals")).toHaveLength(1);
    expect(findFabricated("People are different, and I ask before I advise.")).toHaveLength(0);
  });
  it("strips only the sentences carrying a fabricated claim from generated copy and says what went", () => {
    const r = stripFabricated("Most plans fail by week three.\nIt takes 21 days to build a habit. So I plan for twelve weeks.\nWhat would you try first?");
    expect(r.text).toBe("Most plans fail by week three.\nSo I plan for twelve weeks.\nWhat would you try first?");
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].entry.id).toBe("b02");
    expect(stripNote(r.removed)).toMatch(/^Removed "It takes 21 days to build a habit\.": .*Say instead: /);
    expect(stripNote([])).toBeNull();
  });
});

describe("evidence", () => {
  it("falls back to the claim's own words, and keys the cache by sorted terms", () => {
    expect(fallbackTerms("Hypnotherapy helps people quit smoking.")).toEqual(["hypnotherapy", "quit", "smoking"]);
    expect(queryKey(["Smoking", "hypnotherapy "])).toBe(queryKey(["hypnotherapy", "smoking"]));
  });
  it("flags a year that differs and a title with none of the terms; a flag is never a rejection", () => {
    const asked = { claim: "Self-perception theory", terms: ["self-perception", "attitude"], year: 1972 };
    expect(flagsFor(asked, { title: "The Psychology of Change: Self-Affirmation and Social Psychological Intervention", year: 2014 })).toEqual([
      "Year differs: you asked for 1972, this is 2014.",
      "The title has none of your terms (self-perception, attitude).",
    ]);
    expect(flagsFor(asked, { title: "Self-perception theory", year: 1972 })).toEqual([]);
  });
  it("inserts the claim and the citation together, and sorts by the one number a client can read", () => {
    expect(insertText({ claim: "A small yes makes a bigger yes easier later.", authors: "Freedman & Fraser", year: 1966, title: "Compliance without pressure: The foot-in-the-door technique.", url: "https://doi.org/10.1037/h0023552" })).toBe(
      "A small yes makes a bigger yes easier later (Freedman & Fraser (1966). Compliance without pressure: The foot-in-the-door technique.. https://doi.org/10.1037/h0023552)",
    );
    expect(byCitations([{ citedByCount: 3 }, { citedByCount: 1624 }, { citedByCount: 1187 }]).map((r) => r.citedByCount)).toEqual([1624, 1187, 3]);
  });
  it("ships the nine-study starter shelf, every one with a DOI resolved and a verified title, year and count", () => {
    expect(seed).toHaveLength(9);
    for (const s of seed) {
      expect(s.doi, s.id).toMatch(/^10\./);
      expect(s.citationQuality, s.id).toMatch(/^verified/);
      expect(s.verifiedTitle.length, s.id).toBeGreaterThan(5);
      expect(s.citedByCount, s.id).toBeGreaterThan(0);
    }
    expect(seed.map((s) => s.id)).not.toContain("s08");
  });
});
