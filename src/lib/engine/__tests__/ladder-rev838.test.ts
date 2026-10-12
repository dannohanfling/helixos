import { describe, expect, it } from "vitest";
import type { LadderProfile } from "@/db/schema";
import { checklist, masterBlock, noKeywordHits, perPostInput, scaffold, showPun, withoutKeyword, type Parsed } from "../ladder";

/** Danno's own Ladder facts (rev 838): the product is Book 'Em Danno, and BOOKEM is its keyword. */
const danno = {
  productName: "Book 'Em Danno",
  productPitch: "A booking agent for your calendar.",
  priceLine: "$100 a month.",
  trialLine: "",
  keywords: [{ keyword: "BOOKEM", use: "default", target: { kind: "product" } }],
  verifiedStats: [],
  bannedPhrases: [],
} as unknown as LadderProfile;

describe("No Hawaii Five-0 puns (rev 838)", () => {
  it("passes the product name and the keyword, and catches the show", () => {
    expect(showPun("Book 'Em Danno books the calls for you.", danno)).toBeNull();
    expect(showPun("Comment BOOKEM and I'll send you the link.", danno)).toBeNull();
    expect(showPun("Book 'em, Danno! Cue the Five-0 theme.", danno)).not.toBeNull();
    expect(showPun("Like McGarrett on a Monday.", danno)).toBe("McGarrett");
    expect(showPun("Straight out of Hawaii Five-O.", null)).not.toBeNull();
    // Not the show: an ordinary badge, the police, five o'clock.
    expect(showPun("I wore the badge at the police station until five o'clock.", null)).toBeNull();
  });
  it("is named for the show in the checklist, for every workspace", () => {
    const base = scaffold({ format: "method_resource", topic: "The Three Boxes", audience: "warm", keyword: "BOOKEM" }, danno, []);
    const l = { ...base, keyword: "BOOKEM", realNumbers: null, format: "method_resource" as const, leadMagnetId: null };
    const pun = checklist(l, danno, []).find((c) => c.key === "namepun")!;
    expect(pun.label).toBe("No Hawaii Five-0 puns");
    expect(pun.ok).toBe(true);
  });
});

describe("keyword NONE means none (rev 838)", () => {
  const leaky: Parsed = {
    postName: "SKIN — Method / Resource — The Three Boxes",
    headline: "THREE BOXES / ONE (gold: CALENDAR)",
    altHeadlines: [],
    hook: "Three boxes run my week.",
    copy: "Three boxes run my week.\n\nThe whole plan is in the comments. Read them in order. 👇\n\nWhich box is yours?",
    rungs: [
      { n: 1, body: "Box one is the work.\nBook 'Em Danno keeps it clear.\nKeep it first." },
      { n: 2, body: "Recap: work, people, rest.\nBook 'Em Danno books the calls for you, $100 a month.\nComment BOOKEM and I'll send you the link.\nIf nothing happens, message me BOOKEM.\nWhich rule are you breaking first?" },
    ],
    dmKeyword: "BOOKEM",
    carousel: ["SLIDE 1 — THREE BOXES + SWIPE →", "SLIDE 9 — (solid black) COMMENT BOOKEM"],
    igCaption: "Three boxes.\n\nComment BOOKEM and I'll send you the link.",
    threadsChain: ["1/ Three boxes.", "7/ Message me BOOKEM for the link."],
    screenshotText: "",
    materialUsed: [],
    notes: "",
  };
  it("takes out every keyword, call to action and price, and the field says NONE", () => {
    const out = withoutKeyword(leaky, danno);
    expect(out.dmKeyword).toBe("NONE");
    const all = [out.copy, ...out.rungs.map((r) => r.body), ...out.carousel, out.igCaption, ...out.threadsChain].join("\n");
    expect(all).not.toMatch(/BOOKEM/i);
    expect(all).not.toMatch(/\$100/);
    expect(all).not.toContain("Book 'Em Danno");
    expect(all).not.toMatch(/\b(comment|message me)\b/i);
    expect(noKeywordHits(all, danno)).toEqual([]);
    expect(out.rungs[1].body.split("\n").pop()).toBe("Which rule are you breaking first?");
  });
  it("blocks a NONE ladder that still pitches, and passes the clean one", () => {
    const l = { ...leaky, keyword: "NONE", realNumbers: null, format: "method_resource" as const, leadMagnetId: null };
    const leak = checklist(l, danno, []).find((c) => c.key === "no-keyword")!;
    expect(leak.ok).toBe(false);
    expect(leak.note).toContain("BOOKEM");
    const clean = checklist({ ...l, ...withoutKeyword(leaky, danno) }, danno, []);
    expect(clean.find((c) => c.key === "no-keyword")!.ok).toBe(true);
    expect(clean.find((c) => c.key === "cta")!.ok).toBe(true);
  });
  it("tells the writer: no product, price or keyword routing, and a question to close", () => {
    const block = masterBlock(danno, [], { name: "Danno" }, [], true);
    expect(block).not.toContain("$100");
    expect(block).not.toContain("KEYWORD ROUTING");
    expect(block).toContain("close with one open question");
    expect(masterBlock(danno, [], { name: "Danno" })).toContain("$100");
    expect(perPostInput({ format: "method_resource", topic: "x", audience: "warm", keyword: "NONE" })).toContain("NO KEYWORD ON THIS POST");
    expect(perPostInput({ format: "method_resource", topic: "x", audience: "warm", keyword: "BOOKEM" })).not.toContain("NO KEYWORD ON THIS POST");
  });
});
