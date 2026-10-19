import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { beliefRows, cleanFields, cleanText, deckRows, deckWrite, foundationRows, historyLine, readDeckSlides, readDraftFields, scriptRows, SLIDE_TITLE_MAX, undoOpen } from "@/lib/engine/webinar-drafts";

// H-181: the connector's webinar drafts. The database is never reached in these.
vi.mock("@/db", async (orig) => {
  const real = await orig<typeof import("@/db")>();
  return { ...real, db: {} };
});

describe("reading a draft's fields (H-181)", () => {
  it("takes the foundation's own field names and refuses any other by name", () => {
    const r = readDraftFields("foundation", { title: "The Leak", promise: "Fix the leak", status: "ready", scheduledAt: "2026-11-01", registrationUrl: "https://x", outcomes: ["One", "Two"], originStory: { wanted: "A full room", nope: "x" } });
    expect(r.fields).toEqual({ title: "The Leak", promise: "Fix the leak", outcomes: ["One", "Two"], originStory: { wanted: "A full room" } });
    expect(r.refused.sort()).toEqual(["originStory.nope", "registrationUrl", "scheduledAt", "status"]);
  });
  it("holds category and ctaType to the wizard's own choices, and outcomes to three", () => {
    const r = readDraftFields("foundation", { category: "Webinar", ctaType: "Buy now", outcomes: ["a", "b", "c", "d"] });
    expect(r.fields).toEqual({ ctaType: "Buy now" });
    expect(r.problems.join(" ")).toMatch(/category must be one of/);
    expect(r.problems.join(" ")).toMatch(/at most 3/);
  });
  it("drops an empty string, so a draft never blanks a field", () => {
    expect(readDraftFields("foundation", { audience: "  ", promise: "P" }).fields).toEqual({ promise: "P" });
  });
  it("takes beliefs by act with from, to and cited ids only", () => {
    const r = readDraftFields("beliefs", { vehicle: { from: "Ads are a scam", to: "Ads are a tap", proofId: "p1", proof: "free text" }, money: { from: "x" } });
    expect(r.fields).toEqual({ vehicle: { from: "Ads are a scam", to: "Ads are a tap", proofId: "p1" } });
    expect(r.refused.sort()).toEqual(["money", "vehicle.proof"]);
  });
  it("takes the offer's id and call to action, nothing else", () => {
    const r = readDraftFields("offer", { offerId: "o1", ctaType: "Apply", price: 997 });
    expect(r.fields).toEqual({ offerId: "o1", ctaType: "Apply" });
    expect(r.refused).toEqual(["price"]);
  });
});

describe("no invented numbers or income claims (H-181)", () => {
  it("takes out a sentence with a figure that isn't in the offer or the member's words", () => {
    const c = cleanText("Most clients add 40 leads a month. It works because the room is warm.", "price 997");
    expect(c.text).toBe("It works because the room is warm.");
    expect(c.removed).toEqual(["Most clients add 40 leads a month."]);
  });
  it("keeps a figure the member gave", () => {
    expect(cleanText("Join 3 calls a week.", "I run 3 calls a week").text).toBe("Join 3 calls a week.");
  });
  it("takes out an income claim or a guarantee, even with no figure", () => {
    const c = cleanText("You will make six figures. This is guaranteed to work. Bring a pen.", "");
    expect(c.text).toBe("Bring a pen.");
    expect(c.removed.length).toBe(2);
  });
  it("takes out a fabricated statistic from the blacklist the script drafter uses", () => {
    expect(cleanText("It takes 7 touches to make a sale. Ask them.", "7").text).toBe("Ask them.");
  });
  it("cleans every text in a step, and drops one the cleaning empties", () => {
    const r = cleanFields("foundation", { promise: "Earn 10000 dollars.", audience: "Coaches", outcomes: ["Book 5 calls", "Know your leak"], ctaType: "Apply" }, "");
    expect(r.fields).toEqual({ audience: "Coaches", outcomes: ["Know your leak"], ctaType: "Apply" });
    expect(r.removed.length).toBe(2);
  });
});

describe("the panel and the history (H-181)", () => {
  it("shows only the fields the draft sets, now beside draft", () => {
    const rows = foundationRows({ title: "Old", promise: null, originStory: {} }, { title: "New", originStory: { wall: "The day it stopped" } });
    expect(rows.map((r) => [r.key, r.now, r.draft])).toEqual([["title", "Old", "New"], ["originStory.wall", "", "The day it stopped"]]);
  });
  it("names cited ids for beliefs", () => {
    const rows = beliefRows({ vehicle: { proofId: "p0" } }, { vehicle: { proofId: "p1", to: "It works" } }, (_f, id) => `name of ${id}`);
    expect(rows).toEqual([
      { key: "vehicle.to", label: "Vehicle: They must believe by the end", now: "", draft: "It works" },
      { key: "vehicle.proofId", label: "Vehicle: Proof", now: "name of p0", draft: "name of p1" },
    ]);
  });
  it("says who in plain words, Claude (connector) for a connector write", () => {
    expect(historyLine({ action: "drafted", step: "foundation", byLabel: "Claude (connector)", byConnector: true, changed: ["title", "promise"] })).toBe("Foundation: draft written (2 fields) by Claude (connector)");
    expect(historyLine({ action: "approved", step: "beliefs", byLabel: "Danno", byConnector: false, changed: ["vehicle.to"] })).toBe("Beliefs: draft approved (1 field) by Danno");
  });
  it("keeps Undo open for seven days", () => {
    const at = "2026-10-10T12:00:00.000Z";
    expect(undoOpen(at, Date.parse("2026-10-17T11:59:00Z"))).toBe(true);
    expect(undoOpen(at, Date.parse("2026-10-17T12:01:00Z"))).toBe(false);
  });
});

describe("the connector's webinar tools (H-181)", () => {
  it("lists reads under webinars and writes under webinars:write, never on an agent's forum and inbox", async () => {
    await import("@/lib/mcp/tools/webinars");
    const { toolsFor } = await import("@/lib/mcp/registry");
    const names = (scopes: string[]) => toolsFor(scopes as never).map((t) => t.name).filter((n) => /webinar|story_bank/.test(n)).sort();
    expect(names(["webinars"])).toEqual(["story_bank_list", "webinar_read", "webinar_readiness", "webinars_list"]);
    expect(names(["webinars", "webinars:write"])).toEqual(["story_bank_list", "webinar_create", "webinar_deck_draft", "webinar_draft_step", "webinar_read", "webinar_readiness", "webinars_list"]);
    expect(names(["forum", "inbox"])).toEqual([]);
  });
  it("never writes into the webinar from a tool: drafts go through saveDraft, and only Approve writes values", () => {
    const tools = readFileSync(path.join(process.cwd(), "src/lib/mcp/tools/webinars.ts"), "utf8");
    expect(tools).not.toMatch(/update\(schema\.webinars|update\(schema\.webinarBeliefs|update\(schema\.webinarSections|schema\.deckSlots|insert\(schema\.webinarDrafts/);
    const lib = readFileSync(path.join(process.cwd(), "src/lib/webinar-drafts.ts"), "utf8");
    const saveDraft = lib.slice(lib.indexOf("export async function saveDraft"), lib.indexOf("export type Citation"));
    expect(saveDraft).not.toMatch(/schema\.webinars\b|schema\.webinarBeliefs/);
  });
});

describe("script drafts, one section at a time (H-181 PR 2)", () => {
  it("takes the section form's own fields and refuses any other by name", () => {
    const r = readDraftFields("script", { keyPoints: ["One", " ", "Two"], script: "Say it.", durationMin: 6, buildStyle: "reveal", status: "final", origin: "coach", assetId: "x" });
    expect(r.fields).toEqual({ keyPoints: "One\nTwo", script: "Say it.", durationMin: 6, buildStyle: "reveal" });
    expect(r.refused.sort()).toEqual(["assetId", "origin", "status"]);
  });
  it("holds minutes to whole minutes and the build to none or reveal", () => {
    const r = readDraftFields("script", { durationMin: 2.5, buildStyle: "fade" });
    expect(r.fields).toEqual({});
    expect(r.problems).toHaveLength(2);
  });
  it("cleans key points line by line, so one bad line goes and the rest stand", () => {
    const c = cleanFields("script", { keyPoints: "Find the leak\nOur clients add 40 leads a week\nFix one arch", durationMin: 5 }, "");
    expect(c.fields).toEqual({ keyPoints: "Find the leak\nFix one arch", durationMin: 5 });
    expect(c.removed).toEqual(["Our clients add 40 leads a week"]);
  });
  it("shows the fields it sets beside the section, the build in words", () => {
    const rows = scriptRows({ script: "Old", buildStyle: "none" }, { script: "New", buildStyle: "reveal" });
    expect(rows.map((r) => [r.key, r.now, r.draft])).toEqual([
      ["script", "Old", "New"],
      ["buildStyle", "One point per slide", "Build it up, one point per slide"],
    ]);
  });
});

describe("deck drafts (H-181 PR 2)", () => {
  it("groups slides by section in order, and refuses a field a slide doesn't take", () => {
    const r = readDeckSlides([
      { sectionKey: "hook", title: "The leak" },
      { sectionKey: "promise", title: "One arch at a time", body: ["Find it", "Fix it"] },
      { sectionKey: "hook", title: "Where it drips", layout: "big", speakerNote: "Pause here" },
    ]);
    expect(r.sections.map((g) => [g.sectionKey, g.slides.map((s) => s.title)])).toEqual([
      ["hook", ["The leak", "Where it drips"]],
      ["promise", ["One arch at a time"]],
    ]);
    expect(r.refused).toEqual(["slide 3.layout"]);
  });
  it("needs a section and a title, holds the title to one face, and takes a picture or an idea, not both", () => {
    const r = readDeckSlides([{ title: "No section" }, { sectionKey: "hook" }, { sectionKey: "hook", title: "x".repeat(SLIDE_TITLE_MAX + 1) }, { sectionKey: "hook", title: "Both", imageId: "i1", pictureIdea: "a dam" }, { sectionKey: "hook", title: "Body", body: ["a", "b", "c", "d"] }]);
    expect(r.problems).toHaveLength(5);
  });
  it("refuses an empty list", () => {
    expect(readDeckSlides([]).problems).toHaveLength(1);
    expect(readDraftFields("deck", {}).problems).toEqual(["the deck is drafted with webinar_deck_draft"]);
  });
  it("cleans each slide and drops one whose title the cleaning empties", () => {
    const c = cleanFields("deck", { slides: [{ title: "Earn six figures this year" }, { title: "Find the leak", body: ["We add 40 leads a week", "Then fix it"], speakerNote: "Slow down." }] }, "");
    expect(c.fields).toEqual({ slides: [{ title: "Find the leak", body: ["Then fix it"], speakerNote: "Slow down." }] });
    expect(c.removed).toHaveLength(2);
  });
  it("writes the titles as key points, and the notes as the script only when the section has none", () => {
    const slides = [{ title: "Find the leak", body: ["Look at step two"], speakerNote: "Ask who has one." }, { title: "Fix one arch" }];
    expect(deckWrite(slides, { script: null })).toEqual({ keyPoints: "Find the leak\nFix one arch", script: "Look at step two Ask who has one.", scriptKept: false });
    expect(deckWrite(slides, { script: "My own words" })).toEqual({ keyPoints: "Find the leak\nFix one arch", script: null, scriptKept: true });
    expect(deckWrite([{ title: "Only a line" }], { script: null })).toEqual({ keyPoints: "Only a line", script: null, scriptKept: false });
  });
  it("shows each slide beside the section's line in its place", () => {
    const rows = deckRows("Old one\nOld two", { slides: [{ title: "New one", imageId: "img1" }, { title: "New two", pictureIdea: "a dam" }, { title: "New three" }] }, () => "Gym photo");
    expect(rows.map((r) => [r.label, r.now, r.draft])).toEqual([
      ["Slide 1", "Old one", "New one\nPicture: Gym photo"],
      ["Slide 2", "Old two", "New two\nPicture idea: a dam"],
      ["Slide 3", "", "New three"],
    ]);
  });
  it("names the section in the history line", () => {
    expect(historyLine({ action: "approved", step: "deck", sectionKey: "hook", byLabel: "Maya", byConnector: false, changed: ["slide1", "slide2"] })).toBe("Deck (hook): draft approved (2 slides) by Maya");
  });
});
