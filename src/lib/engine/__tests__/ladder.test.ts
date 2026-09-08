import { describe, expect, it } from "vitest";
import type { LadderProfile, Proof } from "@/db/schema";
import { LADDER_FORMATS, cadenceNotes, checkScore, checklist, masterBlock, outputContract, parseLadderOutput, parseRungs, readyToPost, rungGapMinutes, rungsForAirtable, scaffold } from "../ladder";
import { CHANNEL_SPECS } from "../repurpose";

const profile = {
  productName: "The 90-Day Reset",
  productPitch: "Three template meals, one weekend rule, a daily check-in.",
  priceLine: "$497 for 90 days.",
  trialLine: "Free 7-day starter plan, no card.",
  keywords: [{ keyword: "RESET", use: "default" }],
  scarcityLine: null,
  bannedPhrases: ["cheat day"],
  verifiedStats: [{ stat: "47 moms, average 14 lbs at day 90", source: "program data" }],
  claimsRules: null,
  originStory: "Night-shift nurse for nine years.",
  positioningLine: null,
  handle: "@torres",
} as unknown as LadderProfile;

const proofs = [{ status: "approved", who: "Sarah", name: "Sarah", shortVersion: "Sarah, mom of two: quit every diet by week three. Down 11 lbs at week 6.", resultAfter: null, longVersion: null, punchline: null }] as unknown as Proof[];

const good = (over: Partial<Parameters<typeof checklist>[0]> = {}) => ({
  format: "mistakes" as const,
  keyword: "RESET",
  dmKeyword: "RESET",
  realNumbers: "47 moms, 14 lbs",
  copy: "I quit every diet by week three.\nFor six years.\n\nThe whole plan is in the comments. Read them in order. 👇\n\nSave this.\n\nWhich one is yours?",
  headline: "I QUIT EVERY DIET BY WEEK THREE / UNTIL I STOPPED PLANNING SUNDAYS (gold: WEEK THREE)",
  igCaption: "short caption",
  threadsChain: ["1/ one", "2/ two"],
  rungs: [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n, body: `Mistake ${n}.\n${"I did the thing and it did not work at all for me. ".repeat(4)}\nShort quotable line.` })),
    { n: 9, body: `Proof.\nSarah: "quit every diet by week three. Down 11 lbs at week 6."\n${"She did nothing heroic and it still worked well. ".repeat(3)}\nBoring is what working looks like.` },
    { n: 10, body: `Here's the whole system.\n${"Plan on Tuesday and pick three meals you know. ".repeat(3)}\n$497 for 90 days.\nComment RESET and I'll send you the link.\nIf nothing happens, message me RESET.\nStart small. Stay long.` },
  ],
  ...over,
});

describe("ladder checklist", () => {
  it("clears a well-formed ladder", () => {
    const checks = checklist(good(), profile, proofs);
    const failing = checks.filter((c) => !c.ok);
    expect(failing.map((c) => c.key)).toEqual([]);
    expect(readyToPost(checks)).toBe(true);
    expect(checkScore(checks).total).toBeGreaterThan(15);
  });

  it("blocks comment bait in the body, a missing fallback line, guarantees, fake scarcity and placeholders", () => {
    const checks = checklist(
      good({
        copy: "Comment RESET to get the plan.\nIt's guaranteed to work.",
        rungs: good().rungs.map((r) => (r.n === 10 ? { ...r, body: r.body.replace("If nothing happens, message me RESET.", "Only 5 spots left! [VERIFY PRICE]") } : r)),
      }),
      profile,
      proofs,
    );
    const failed = new Set(checks.filter((c) => !c.ok && c.level === "fail").map((c) => c.key));
    for (const k of ["question", "bait", "cta", "guarantee", "scarcity", "placeholders"]) expect(failed.has(k), k).toBe(true);
    expect(readyToPost(checks)).toBe(false);
  });

  it("flags banned phrases, tool-earns-money claims and unapproved testimonials", () => {
    const checks = checklist(
      good({ rungs: good().rungs.map((r) => (r.n === 3 ? { ...r, body: `${r.body}\nNo cheat day here. The bot generates leads for you.\nBrianna T.: "I signed another client today for real."` } : r)) }),
      profile,
      proofs,
    );
    const failed = new Set(checks.filter((c) => !c.ok).map((c) => c.key));
    expect(failed.has("banned")).toBe(true);
    expect(failed.has("tools-earn")).toBe(true);
    expect(failed.has("testimonials")).toBe(true);
  });

  it("checks the headline shape and platform limits", () => {
    const checks = checklist(good({ headline: "ONE LINE ONLY (gold: ONE) (gold: LINE)", threadsChain: ["x".repeat(501)], igCaption: "y".repeat(2201) }), profile, proofs);
    const failed = new Set(checks.filter((c) => !c.ok).map((c) => c.key));
    for (const k of ["headline-lines", "headline-gold", "threads", "ig"]) expect(failed.has(k), k).toBe(true);
  });

  it("a story post with no keyword must end its final rung with a question, and a numbers teardown needs real data", () => {
    const noKw = checklist(good({ keyword: "NONE", dmKeyword: "NONE", rungs: good().rungs.map((r) => (r.n === 10 ? { ...r, body: "Recap.\nSo what would you do first?" } : r)) }), profile, proofs);
    expect(noKw.find((c) => c.key === "cta")?.ok).toBe(true);
    const numbers = checklist(good({ format: "numbers_teardown", realNumbers: "" }), profile, proofs);
    expect(numbers.find((c) => c.key === "stop-numbers")?.ok).toBe(false);
  });
});

describe("ladder parsing and hand-offs", () => {
  it("parses the output contract, escaped or plain numbering, and --- dividers", () => {
    const text = `POST_NAME: SKIN — Mistakes — week three
HEADLINE
I QUIT EVERY DIET BY WEEK THREE / UNTIL I STOPPED (gold: WEEK THREE)
ALT_HEADLINES
ALT ONE / ALT TWO (gold: TWO)
HOOK: I quit every diet by week three.
COPY
Line one.
Line two?
SUPPORTING_COMMENTS
1\\. First rung body.
Quotable one.
---
2. Second rung body.
Quotable two.
DM_KEYWORD: RESET
IG_CAROUSEL
SLIDE 1 — HEADLINE + SWIPE →
SLIDE 2 — Big plans die on Tuesday. (gold: TUESDAY)
IG_CAPTION
Caption here.
THREADS_CHAIN
1/ one
---
2/ two
NOTES
Verify Sarah's quote.`;
    const p = parseLadderOutput(text);
    expect(p.postName).toBe("SKIN — Mistakes — week three");
    expect(p.headline).toContain("(gold: WEEK THREE)");
    expect(p.altHeadlines).toEqual(["ALT ONE / ALT TWO (gold: TWO)"]);
    expect(p.hook).toBe("I quit every diet by week three.");
    expect(p.copy).toBe("Line one.\nLine two?");
    expect(p.rungs.map((r) => r.n)).toEqual([1, 2]);
    expect(p.rungs[0].body).toBe("First rung body.\nQuotable one.");
    expect(p.dmKeyword).toBe("RESET");
    expect(p.carousel).toHaveLength(2);
    expect(p.threadsChain).toEqual(["1/ one", "2/ two"]);
    expect(p.notes).toBe("Verify Sarah's quote.");
  });

  it("splits numbered rungs without dividers and escapes them for Airtable", () => {
    const rungs = parseRungs("1. One.\nQuote one.\n2. Two.\nQuote two.\n3) Three.\nQuote three.");
    expect(rungs).toHaveLength(3);
    expect(rungsForAirtable(rungs)).toBe("1\\. One.\nQuote one.\n---\n2\\. Two.\nQuote two.\n---\n3\\. Three.\nQuote three.");
  });

  it("scaffolds every format with placeholders the checklist refuses to pass", () => {
    for (const f of LADDER_FORMATS) {
      const s = scaffold({ format: f.key, topic: "Losing 15 lbs", audience: "warm", keyword: "RESET" }, profile, proofs);
      expect(s.rungs.length, f.key).toBeGreaterThanOrEqual(9);
      expect(s.rungs[s.rungs.length - 1].body).toContain("message me RESET");
      const checks = checklist({ ...s, format: f.key, keyword: "RESET", realNumbers: "" }, profile, proofs);
      expect(checks.find((c) => c.key === "placeholders")?.ok, f.key).toBe(false);
    }
  });

  it("builds the master block from the client's facts, never Danno's", () => {
    const block = masterBlock(profile, proofs, { name: "Maya Torres", businessName: "Torres Nutrition", bigPromise: "15 lbs in 90 days" });
    expect(block).toContain("Maya Torres");
    expect(block).toContain("The 90-Day Reset");
    expect(block).toContain("RESET — default");
    expect(block).toContain("47 moms");
    expect(block).toContain("Sarah");
    expect(block).toContain("No scarcity line of any kind");
    expect(block).not.toMatch(/Book 'Em|Lamborfeeties|BOOKEM/);
    // The format rule is the channel's, attached to the output field; the top block only points at it
    expect(block).toContain("## FORMAT");
    expect(block).not.toMatch(/^- 4th-grade/m);
  });

  it("attaches each channel's format line to the output field that lands on it", () => {
    const section = (text: string, name: string) => text.split(`\n${name}\n`)[1]?.split("\n\n")[0] ?? "";
    const fb = "FORMAT (Facebook personal, Facebook business page): 4th-grade reading level. Sentences average 5–7 words. Line break between every sentence or short thought.";
    const today = outputContract();
    expect(section(today, "COPY")).toContain(fb);
    expect(section(today, "SUPPORTING_COMMENTS")).toContain(fb);
    expect(section(today, "IG_CAPTION")).toContain("FORMAT (Instagram caption): The first line is the whole hook;");
    expect(section(today, "THREADS_CHAIN")).toContain("FORMAT (Threads): Under 500 characters a post.");
    expect(section(today, "HEADLINE")).not.toContain("FORMAT");
    expect(section(today, "IG_CAROUSEL")).not.toContain("FORMAT");
    // When a channel's line lands as data, its field carries it and nothing else moves
    const later = outputContract(CHANNEL_SPECS.map((c) => (c.key === "instagram" ? { ...c, format: "First line is the hook." } : c.key === "fb_page" ? { ...c, format: "Page line." } : c.key === "threads" ? { ...c, format: "" } : c)));
    expect(section(later, "IG_CAPTION")).toContain("FORMAT (Instagram caption): First line is the hook.");
    expect(section(later, "THREADS_CHAIN")).not.toContain("FORMAT");
    expect(section(later, "COPY")).toContain("FORMAT (Facebook personal): 4th-grade");
    expect(section(later, "COPY")).toContain("FORMAT (Facebook business page): Page line.");
  });
});

describe("cadence", () => {
  it("wants Tuesday to Thursday mornings with 72 hours between ladders", () => {
    // 2026-09-08 is a Tuesday. 09:00 Los Angeles = 16:00Z.
    const ok = cadenceNotes("2026-09-08T16:00:00.000Z", "America/Los_Angeles", "2026-09-03T16:00:00.000Z");
    expect(ok.every((n) => n.ok)).toBe(true);
    const bad = cadenceNotes("2026-09-06T02:00:00.000Z", "America/Los_Angeles", "2026-09-05T16:00:00.000Z");
    expect(bad.filter((n) => !n.ok)).toHaveLength(3);
    expect(rungGapMinutes(11)).toBe(5);
    expect(rungGapMinutes(5)).toBe(6);
  });
});
