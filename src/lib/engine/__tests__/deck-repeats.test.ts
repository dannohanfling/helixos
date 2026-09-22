import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTION_TEMPLATES, buildChecks } from "../webinar";
import { resolveSections, type BeliefRow, type SectionRow } from "../webinar-context";
import { NEUTRAL_KIT, deckPace, deckSlides, paceLine, perMinute, slidesWord } from "../deck";

const base = (over: Partial<Record<string, Partial<SectionRow>>> = {}): SectionRow[] =>
  SECTION_TEMPLATES.map((t) => ({ sectionKey: t.key, act: t.act, order: t.order, name: t.name, status: "drafted", keyPoints: null, script: null, transitionIn: null, transitionOut: null, deliveryNote: null, assetId: null, durationMin: t.durationMin, ...(over[t.key] ?? {}) }));
// Two approved proofs, each with a long and a short version, named as on the live deck of 22 Sep.
const KATE_LONG = "I now see identity as the foundation of every decision I make with my team.";
const KATE_SHORT = "Identity is the foundation of every decision I make.";
const RACHAEL_LONG = "Within six weeks I stopped firefighting and started leading the quarter I had planned.";
const proofs = [
  { id: "kate", who: "Kate A.", name: "Kate A.: identity", longVersion: KATE_LONG, shortVersion: KATE_SHORT, status: "approved" },
  { id: "rachael", who: "Rachael C.", name: "Rachael C.: six weeks", longVersion: RACHAEL_LONG, status: "approved" },
];
const belief = (type: string, proofId: string, over: Partial<BeliefRow> = {}): BeliefRow => ({ type, fromBelief: "a", toBelief: "b", proofId, ...over });
const deckOf = (sections: SectionRow[], beliefs: BeliefRow[]) =>
  deckSlides(resolveSections({ webinar: { title: "Your Edge, Uncovered" }, presenter: "Lindsey Brittain", sections, beliefs, proofs, assets: [], essenceStories: [], citable: [], offer: null }), NEUTRAL_KIT);
const showing = (d: ReturnType<typeof deckSlides>, words: string) => d.slides.filter((s) => [s.headline, ...s.body].some((l) => l.includes(words)));

describe("C. each proof appears once in a deck, unless the coach places it twice on purpose", () => {
  it("two acts naming the same proof: its Proof Block slide appears once, in the first act; the second is listed, not shown", () => {
    const d = deckOf(base(), [belief("vehicle", "kate"), belief("internal", "kate"), belief("external", "rachael")]);
    const kate = showing(d, KATE_LONG);
    expect(kate.map((s) => s.sectionKey)).toEqual(["proof_block"]);
    expect(d.repeats).toEqual([{ slide: null, section: "Proof Block (Internal)", who: "Kate A.", shownOn: kate[0].n, text: `“${KATE_LONG}”` }]);
    expect(showing(d, RACHAEL_LONG)).toHaveLength(1);
    expect(d.slides.map((s) => s.n)).toEqual(d.slides.map((_, i) => i + 1));
  });
  it("a key point quoting a proof (any of its versions) comes off; the Proof Block slide is the proof's home even when it comes later", () => {
    // Rachael's words typed as a Vehicle key point (earlier in the deck) while her Proof Block slide is in the Internal act;
    // Kate's short version quoted in a key point after her own slide.
    const sections = base({
      mechanism_reveal: { keyPoints: `Three moves that change the quarter\n“${RACHAEL_LONG}” — Rachael C.` },
      case_study: { keyPoints: `She said it plainly: "${KATE_SHORT}"\nThe drift has a name` },
    });
    const d = deckOf(sections, [belief("vehicle", "kate"), belief("internal", "rachael")]);
    const rachael = showing(d, RACHAEL_LONG);
    expect(rachael.map((s) => [s.kind, s.sectionKey])).toEqual([["proof", "proof_block_internal"]]);
    expect(showing(d, KATE_SHORT)).toEqual([]);
    expect(showing(d, KATE_LONG).map((s) => s.kind)).toEqual(["proof"]);
    // The Vehicle recap quotes each section's first line, so it re-showed Kate's words too: that comes off as well, and is named.
    const recap = d.slides.find((s) => s.kind === "recap" && s.act === "vehicle")!;
    expect(d.repeats.map((r) => [r.who, r.section, r.slide, r.shownOn])).toEqual([
      ["Rachael C.", "Mechanism Reveal", null, rachael[0].n],
      ["Kate A.", "Case Study", null, showing(d, KATE_LONG)[0].n],
      ["Kate A.", "Act 1 · Vehicle", recap.n, showing(d, KATE_LONG)[0].n],
    ]);
    // A line that was a repeat on a slide with other lines is gone from the face and named in that slide's notes.
    expect(d.slides.some((s) => s.notes.some((n) => n.startsWith("Not shown again (Kate A.'s proof is on slide")))).toBe(true);
  });
  it("the coach's tick on an act shows a proof there again, on purpose", () => {
    const d = deckOf(base(), [belief("vehicle", "kate"), belief("internal", "kate", { proofRepeat: true })]);
    expect(showing(d, KATE_LONG).map((s) => s.sectionKey)).toEqual(["proof_block", "proof_block_internal"]);
    expect(d.repeats).toEqual([]);
  });
  it("a line that names the person with other words is not the same proof, and stays", () => {
    const d = deckOf(base({ case_study: { keyPoints: "Kate A. rebuilt her leadership team in six weeks flat" } }), [belief("vehicle", "kate")]);
    // On its own slide and, as its section's first line, on the act's recap: both stay.
    expect(showing(d, "Kate A. rebuilt her leadership team").map((s) => s.kind)).toEqual(["section", "recap"]);
    expect(d.repeats).toEqual([]);
  });
});

describe("E. the pace line says what each number is, and the count agrees with its noun", () => {
  it("the band is where a first draft lands; 1.7 is what the finished reference deck ran at", () => {
    const sections = base({ hook: { keyPoints: "One\nTwo" } });
    const c = resolveSections({ webinar: { title: "T" }, presenter: "P", sections, beliefs: [], proofs: [], assets: [], essenceStories: [], citable: [], offer: null });
    const line = paceLine(deckPace(c, deckSlides(c, NEUTRAL_KIT)));
    expect(line).toContain("A first draft lands between 1.2 and 1.5; the finished reference deck ran at 1.7 (a live 90-minute deck, Q&A not counted).");
    expect(line).not.toMatch(/Reference pace is|the band is/);
  });
  it("one slide a minute is a slide, not slides", () => {
    expect(perMinute(1)).toBe("1 slide a minute");
    expect(perMinute(1.3)).toBe("1.3 slides a minute");
    expect(perMinute(null)).toBe("– slides a minute");
    expect(slidesWord(1)).toBe("1 slide");
    expect(slidesWord(33)).toBe("33 slides");
    const input = { webinar: { title: "T", audience: "a", coreProblem: "b", promise: "c", mechanismName: "d", offerId: null, scheduledAt: null } } as unknown as Parameters<typeof buildChecks>[0];
    const check = (rate: number) => buildChecks({ ...input, sections: [], beliefs: [], components: [], presenter: "P", presenterAliases: [], deck: { refused: 0, rate }, review: null }).checks.find((x) => x.key === "deck")!.detail;
    expect(check(1)).toMatch(/^1 slide a minute;/);
  });
});

describe("D. a webinar resolves against its owner, never whoever is signed in", () => {
  it("contextFor takes the webinar alone and reads the owner's material and name", () => {
    const src = readFileSync(join(__dirname, "..", "..", "queries", "webinar.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function contextFor"), src.indexOf("\n}\n", src.indexOf("export async function contextFor")));
    expect(fn).toMatch(/^export async function contextFor\(w: schema\.Webinar\)/);
    expect(fn).toMatch(/subjectFor\(\{ userId: w\.userId, workspaceId: w\.workspaceId/);
    expect(fn).not.toMatch(/\bv\.user\b|Viewer/);
  });
});
