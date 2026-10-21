import { describe, expect, it } from "vitest";
import { cleanFields, offerFacts, readFields, redLines, rowsFor } from "@/lib/engine/claude-drafts";

/** Claude's drafts everywhere (H-184), the pure rules: fields by name only, cleaned words, and the red lines that keep Approve off. */
describe("reading an offer draft's fields", () => {
  it("takes the offer's own fields and refuses any other by name", () => {
    const r = readFields("offer", { name: "  The Reset ", promise: "Calm mornings.", status: "live", paymentLink: "https://x", botTerms: "no", container: "group program", pathSteps: ["One", " ", "Two"], price: "1,997" });
    expect(r.refused.sort()).toEqual(["botTerms", "paymentLink", "status"]);
    expect(r.fields).toEqual({ name: "The Reset", promise: "Calm mornings.", container: "Group program", pathSteps: ["One", "Two"], price: 1997 });
    expect(r.problems).toEqual([]);
  });
  it("says what's wrong with a value of the wrong kind, and never blanks a field", () => {
    const r = readFields("offer", { container: "Retreat", price: "about two grand", pathSteps: ["1", "2", "3", "4", "5", "6"], promise: "   ", currency: 3 });
    expect(r.problems).toHaveLength(4);
    expect(r.fields).toEqual({});
    expect(readFields("offer", "not an object").problems).toHaveLength(1);
  });
});

describe("cleaning the words", () => {
  it("takes out an income claim and a figure the member didn't give, and keeps their own", () => {
    const known = offerFacts([{ name: "Reset", price: 997, promise: "Lose 10 lbs in 90 days." }]);
    const c = cleanFields("offer", { promise: "Lose 10 lbs in 90 days. Make $10,000 a month from home.", whyTrust: "I've coached 400 women.", pathSteps: ["Reset the mornings", "Earn six figures"] }, known);
    expect(c.fields).toEqual({ promise: "Lose 10 lbs in 90 days.", pathSteps: ["Reset the mornings"] });
    expect(c.removed).toEqual(expect.arrayContaining(["Make $10,000 a month from home.", "I've coached 400 women.", "Earn six figures"]));
  });
});

describe("the red lines", () => {
  const now = { name: "Reset", promise: "Old promise.", price: 997 };
  it("is clear when nothing moved and the price is theirs", () => {
    expect(redLines("offer", { fields: { promise: "New.", price: 997 }, base: { promise: "Old promise.", price: 997 } }, now, offerFacts([now]))).toEqual([]);
  });
  it("blocks a draft whose field changed since it was written", () => {
    const red = redLines("offer", { fields: { promise: "New." }, base: { promise: "What it said then." } }, now, "");
    expect(red).toHaveLength(1);
    expect(red[0]).toMatch(/The Big Promise changed since Claude wrote this/);
  });
  it("blocks a price that isn't in their facts, until it is", () => {
    expect(redLines("offer", { fields: { price: 1497 }, base: { price: 997 } }, now, offerFacts([now]))[0]).toMatch(/price 1497 isn't in your own facts/);
    expect(redLines("offer", { fields: { price: 1497 }, base: { price: 997 } }, now, `${offerFacts([now])}\nI'm charging 1,497 now`)).toEqual([]);
    expect(redLines("offer", { fields: { price: 1497 }, base: {} }, null, "")).toHaveLength(1);
  });
});

describe("the panel's rows", () => {
  it("shows only what the draft sets, in the form's order, with a path as numbered lines", () => {
    expect(rowsFor("offer", { promise: "Old", pathSteps: [] }, { pathSteps: ["A", "B"], promise: "New" })).toEqual([
      { key: "promise", label: "The Big Promise", now: "Old", draft: "New" },
      { key: "pathSteps", label: "The path", now: "", draft: "1. A\n2. B" },
    ]);
  });
});

describe("Essence, lead magnet and post drafts (D2b)", () => {
  it("takes an Essence section's own fields only, its stories as {name, summary, when_to_use}", () => {
    const r = readFields("essence", { mission_statement: "Help coaches sell with calm.", vision_statement: " ", tone: "warm" }, "mission_and_vision");
    expect(r.refused).toEqual(["tone"]);
    expect(r.fields).toEqual({ mission_statement: "Help coaches sell with calm." });
    const st = readFields("essence", { stories: [{ name: "The empty room", summary: "Nobody came; I kept going.", when_to_use: "On doubt" }, { name: "" }] }, "representative_stories");
    expect(st.fields).toEqual({ stories: [{ name: "The empty room", summary: "Nobody came; I kept going.", when_to_use: "On doubt" }] });
    expect(readFields("essence", { anything: "x" }, "no_such_section").refused).toEqual(["anything"]);
  });

  it("reads a magnet's content in the editor's own format, and refuses its keyword and publishing", () => {
    const r = readFields("magnet", { title: "Calm Mornings Checklist", content: "Start here.\n## Night before\n- Lay out clothes\n---\nBook a call to go further.", keyword: "CALM", publishedAt: "now" });
    expect(r.refused.sort()).toEqual(["keyword", "publishedAt"]);
    expect(r.fields.content).toEqual({ intro: "Start here.", sections: [{ heading: "Night before", items: ["Lay out clothes"] }], closing: "Book a call to go further." });
    expect(rowsFor("magnet", null, r.fields).find((x) => x.key === "content")!.draft).toContain("## Night before");
  });

  it("takes a post's date as a real date only, and never its status or schedule", () => {
    const r = readFields("content", { title: "Why mornings fail", suggestedDate: "2026-11-03", status: "scheduled", postAt: "2026-11-03T09:00:00", contentType: "story post" });
    expect(r.refused.sort()).toEqual(["postAt", "status"]);
    expect(r.fields).toEqual({ title: "Why mornings fail", suggestedDate: "2026-11-03", contentType: "Story Post" });
    expect(readFields("content", { suggestedDate: "2026-02-30" }).problems).toHaveLength(1);
  });

  it("cleans every story and every magnet line", () => {
    const c = cleanFields("magnet", { content: { intro: "Make $5,000 a week.", sections: [{ heading: "Start", items: ["Do this", "Join 9,000 people"] }], closing: "Book a call." } }, "");
    expect(c.fields.content).toEqual({ intro: "", sections: [{ heading: "Start", items: ["Do this"] }], closing: "Book a call." });
    const s = cleanFields("essence", { stories: [{ name: "Win", summary: "She made six figures.", when_to_use: "" }] }, "", "representative_stories");
    expect(s.fields.stories).toEqual([{ name: "Win", summary: "", when_to_use: "" }]);
  });

  it("keeps Approve off on a post already scheduled or posted", () => {
    expect(redLines("content", { fields: { hook: "New" }, base: { hook: null } }, { hook: null, status: "scheduled" }, "")[0]).toMatch(/already scheduled/);
    expect(redLines("content", { fields: { hook: "New" }, base: { hook: null } }, { hook: null, status: "idea" }, "")).toEqual([]);
  });
});

describe("what the bot says (D2c)", () => {
  it("takes the bot's words only, never its booking link or the guarantee's terms", () => {
    const r = readFields("bot_profile", { whatIDo: "I help coaches.", bookingUrl: "https://x", guaranteeTerms: {}, botQuestion2: "When can you start?" });
    expect(r.refused.sort()).toEqual(["bookingUrl", "guaranteeTerms"]);
    expect(r.fields).toEqual({ whatIDo: "I help coaches.", botQuestion2: "When can you start?" });
  });
});
