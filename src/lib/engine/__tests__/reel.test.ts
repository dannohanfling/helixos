import { describe, expect, it } from "vitest";
import type { LadderProfile, Proof } from "@/db/schema";
import { checklist, formatFor, isReel, rungGapMinutes } from "../ladder";
import { REEL_RUNGS, looksSilent, mergeFlags, parseHooks, parseReelOutput, reelContract, reelFlags, reelInput, reelScaffold, spokenKeyword, topicFromTranscript } from "../reel";

const profile = {
  productName: "The 90-Day Reset",
  keywords: [{ keyword: "RESET", use: "default", target: { kind: "product" } }, { keyword: "ROOM", use: "the community", target: { kind: "conversation", line: "A talk about the community." } }],
  verifiedStats: [{ stat: "47 moms, average 14 lbs at day 90", source: "program data" }],
  bannedPhrases: [],
} as unknown as LadderProfile;
const proofs = [{ status: "approved", who: "Sarah", name: "Sarah", shortVersion: "Down 11 lbs at week 6.", resultAfter: null, longVersion: null, punchline: null, quote: null }] as unknown as Proof[];

const OUTPUT = `POST_NAME:
SKIN — Reel — Sunday planning
HOOKS:
1. I planned every meal on Sunday... and quit by Wednesday.
2. Sunday planning is why you quit. (pick)
3. Stop planning Sundays.
CAPTION:
Sunday planning is why you quit.

The whole story is in the comments. 👇
SUPPORTING_COMMENTS:
1. The moment.
2. The problem.
3. The turn.
4. The how-to.
5. Who it's for.
Comment RESET and I'll send you the link.
DM_KEYWORD:
RESET
COVER:
STOP PLANNING
SUNDAYS
ON_SCREEN:
Stop planning Sundays
FLAGS:
[HEARING] "Sundays" may be "sundaes".
[NOPE] ignored
NOTES:
Short.`;

describe("Reel to Post (H-1948)", () => {
  it("is its own format, kept out of the 13 a member picks", () => {
    expect(isReel({ format: "reel" })).toBe(true);
    expect(isReel({ format: "mistakes" })).toBe(false);
    expect(formatFor("reel").key).toBe("reel");
    expect(rungGapMinutes(5, "reel")).toBe(5);
    expect(rungGapMinutes(10)).toBe(6);
  });

  it("asks the writer for exactly 5 rungs and the reel's fields", () => {
    const c = reelContract();
    for (const f of ["POST_NAME", "HOOKS", "CAPTION", "SUPPORTING_COMMENTS", "DM_KEYWORD", "COVER", "ON_SCREEN", "FLAGS", "NOTES"]) expect(c).toContain(`\n${f}\n`);
    expect(REEL_RUNGS).toBe(5);
    const input = reelInput({ format: "reel", topic: "t", audience: "warm", keyword: "NONE", sourceMaterial: "What I said." } as never);
    expect(input).toContain("Exactly 5 rungs");
    expect(input).toContain("KEYWORD: NONE");
    expect(input).toContain("What I said.");
  });

  it("parses the package: hooks with one pick, caption, 5 rungs, cover, on-screen text and the writer's flags", () => {
    const p = parseReelOutput(OUTPUT);
    expect(p.postName).toBe("Sunday planning");
    expect(p.hookOptions.map((h) => h.pick)).toEqual([false, true, false]);
    expect(p.hook).toBe("Sunday planning is why you quit.");
    expect(p.copy).toBe(p.igCaption);
    expect(p.rungs).toHaveLength(5);
    expect(p.headline).toBe("STOP PLANNING / SUNDAYS");
    expect(p.onScreen).toBe("Stop planning Sundays");
    expect(p.dmKeyword).toBe("RESET");
    expect(p.writerFlags).toEqual([{ kind: "hearing", text: '"Sundays" may be "sundaes".', from: "writer" }]);
    expect(parseReelOutput(OUTPUT.replace(/FLAGS:\n[\s\S]*?NOTES:/, "FLAGS:\nNONE\nNOTES:")).writerFlags).toEqual([]);
  });

  it("picks the first hook when none is marked, and only one when two are", () => {
    expect(parseHooks("a\nb\nc").map((h) => h.pick)).toEqual([true, false, false]);
    expect(parseHooks("a (pick)\nb (pick)\nc\nd").map((h) => [h.text, h.pick])).toEqual([["a", true], ["b", false], ["c", false]]);
  });

  it("flags numbers, prices, named people, a platform claim and a spoken keyword not on facts", () => {
    const t = "My client Jessica doubled her bookings in a month. It costs $297 a month. 47 moms, average 14 lbs at day 90. Set up auto replies on your personal profile. Comment SYSTEM below.";
    const kinds = reelFlags(t, profile, proofs).map((f) => f.kind);
    expect(kinds).toEqual(["number", "price", "person", "platform", "keyword"]);
    expect(reelFlags(t, profile, proofs).every((f) => f.from === "code")).toBe(true);
    expect(reelFlags("A client named Sarah got there. Comment RESET.", profile, proofs)).toEqual([]);
  });

  it("knows the keyword said on camera and whether it is on facts", () => {
    expect(spokenKeyword("comment reset and I'll send it", profile)).toEqual({ keyword: "RESET", onFacts: true });
    expect(spokenKeyword('Comment "SYSTEM" below', profile)).toEqual({ keyword: "SYSTEM", onFacts: false });
    expect(spokenKeyword("comment below", profile)).toBeNull();
    expect(spokenKeyword("no call to action", profile)).toBeNull();
  });

  it("merges the writer's flags after the code's, without repeats", () => {
    const code = [{ kind: "price" as const, text: 'You said "$297" on camera.', from: "code" as const }];
    const merged = mergeFlags(code, [{ kind: "price", text: 'You said "$297" on camera.', from: "writer" }, { kind: "dm", text: "The DM must send the guide.", from: "writer" }]);
    expect(merged.map((f) => f.kind)).toEqual(["price", "dm"]);
  });

  it("names a topic from the first sentence and spots a reel with no talking", () => {
    expect(topicFromTranscript("I used to plan every meal on Sunday. Then I stopped.")).toBe("I used to plan every meal on Sunday");
    expect(topicFromTranscript("   ")).toBe("A reel");
    expect(looksSilent("music only")).toBe(true);
    expect(looksSilent("I used to spend every Sunday afternoon planning meals for the week and by Wednesday I had quit again")).toBe(false);
  });

  it("the skeleton has the reel's shape with every blank marked", () => {
    const s = reelScaffold({ format: "reel", topic: "Sunday planning", audience: "warm", keyword: "ROOM" } as never, profile);
    expect(s.rungs).toHaveLength(5);
    expect(s.rungs[4].body).toContain("Comment ROOM and I'll message you.");
    expect(s.hookOptions.filter((h) => h.pick)).toHaveLength(1);
    expect(s.postName).toBe("Sunday planning");
  });

  it("checks a reel by its own rules: exactly 5 rungs, one Comment line, a cover frame, no Threads", () => {
    const p = parseReelOutput(OUTPUT);
    const l = { format: "reel" as const, keyword: "RESET", dmKeyword: "RESET", realNumbers: "", copy: p.copy, headline: p.headline, igCaption: p.igCaption, threadsChain: [], rungs: p.rungs };
    const checks = checklist(l, profile, proofs);
    expect(checks.find((c) => c.key === "count")?.ok).toBe(true);
    expect(checks.find((c) => c.key === "threads")).toBeUndefined();
    expect(checks.find((c) => c.key === "headline-words")).toBeUndefined();
    expect(checks.find((c) => c.key === "reel-fallback")?.ok).toBe(true);
    const six = checklist({ ...l, rungs: [...l.rungs, { n: 6, body: "Extra." }] }, profile, proofs);
    expect(six.find((c) => c.key === "count")?.ok).toBe(false);
    const fallback = checklist({ ...l, rungs: l.rungs.map((r) => (r.n === 5 ? { ...r, body: `${r.body}\nIf nothing happens, message me RESET.` } : r)) }, profile, proofs);
    expect(fallback.find((c) => c.key === "reel-fallback")?.ok).toBe(false);
  });
});
