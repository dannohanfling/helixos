import { describe, expect, it } from "vitest";
import { backfillSummary, buildBackfill, feedbackMonthOf, oohCategory, oohOutcome } from "@/lib/engine/coach-backfill";
import type { AirtableRecord } from "@/lib/engine/airtable-import";

const rec = (id: string, fields: Record<string, unknown>, createdTime = "2026-03-02T09:00:00.000Z"): AirtableRecord => ({ id, createdTime, fields });
const members = [
  { userId: "u1", email: "joy@example.com", name: "Joy" },
  { userId: "u2", email: "tom@example.com", name: "Tom" },
];
const emails = new Map([
  ["recF1", "Joy@Example.com"],
  ["recF2", "tom@example.com"],
]);
const answers = { "🏆 Proud": "Launched", "❤ Love": "The calls", "⬇ Less": "Admin", "⬆ More": "Feedback", "😮 Wow": "The bot" };
const none = { feedbackMonths: new Set<string>(), oohIds: new Set<string>() };

describe("coach backfill (rev 441)", () => {
  it("names the month a feedback row is about", () => {
    expect(feedbackMonthOf("2026-01-03", "🔵 December")).toBe("2025-12");
    expect(feedbackMonthOf("2026-03-30", "💚 March")).toBe("2026-03");
    expect(feedbackMonthOf("2026-03-02", "")).toBe("2026-02");
    expect(feedbackMonthOf("2026-03-15", "")).toBe("2026-03");
  });
  it("lands feedback on the member by the linked card's email, as written, dated when sent", () => {
    const p = buildBackfill({ feedback: [rec("recA", { ...answers, "📆 Date": "2026-03-01", "🗓 Month": "💙 February", "🔢 NPS": 9, "📣 Referrals": "Sam", "⭐ Favorite": "Fridays", "👨🏻‍🤝‍👨🏻 Member Card": ["recF1"] })], support: [], emails }, members, none);
    expect(p.feedback).toEqual([
      expect.objectContaining({ userId: "u1", month: "2026-02", proud: "Launched", wow: "The bot", referralScore: 9, referral: "Sam", favorite: "Fridays", createdAt: "2026-03-01 12:00:00", status: "new" }),
    ]);
  });
  it("never overwrites a month the member already has, and keeps the later of two Airtable rows", () => {
    const rows = [
      rec("recA", { ...answers, "📆 Date": "2026-03-01", "🔢 NPS": 8, "👨🏻‍🤝‍👨🏻 Member Card": ["recF1"] }),
      rec("recB", { ...answers, "📆 Date": "2026-03-03", "🔢 NPS": 10, "👨🏻‍🤝‍👨🏻 Member Card": ["recF1"] }),
    ];
    const p = buildBackfill({ feedback: rows, support: [], emails }, members, { feedbackMonths: new Set(["u1|2026-02"]), oohIds: new Set() });
    expect(p.feedback.map((f) => [f.recordId, f.status])).toEqual([["recB", "already"]]);
    expect(p.skipped.map((s) => s.recordId)).toEqual(["recA"]);
  });
  it("leaves out what it can't place, and says why", () => {
    const p = buildBackfill(
      {
        feedback: [
          rec("recX", { ...answers, "🔢 NPS": 9, "👨🏻‍🤝‍👨🏻 Member Card": ["recNobody"] }),
          rec("recY", { ...answers, "👨🏻‍🤝‍👨🏻 Member Card": ["recF2"] }),
          rec("recZ", { "🔢 NPS": 9, "👨🏻‍🤝‍👨🏻 Member Card": ["recF2"] }),
        ],
        support: [],
        emails,
      },
      members,
      none,
    );
    expect(p.feedback).toEqual([]);
    expect(p.skipped.map((s) => s.why)).toEqual(["No HelixOS member has this row's email.", "No referral score (HelixOS needs 1 to 10).", "No answers in it."]);
  });
  it("maps both generations of the Office Hours form, matched on the record id", () => {
    const now = rec("recO1", {
      "⏱️ Time Created": "2026-09-20T15:00:00.000Z",
      "🗓 Workshop Date": "2026-09-26",
      Email: "tom@example.com",
      "Please explain the obstacle at hand": "The funnel breaks",
      "What have you done to try to solve the issue?": "Rebuilt it",
      "💡 What is the solution we are trying to achieve on our call?": "A working funnel",
      "🧰 What tools are necessary?": ["GoHighLevel", "Zapier"],
      "⛓ Category": "funnels",
      "📊 Status": "✅ Resolved",
      Responsible: { id: "usr1", name: "Danno Hanfling" },
      "✍ Notes": "Fixed live",
      "📽 Loom": "https://loom.com/x",
    });
    const old = rec("recO2", { "👨‍💼 Member": ["recF1"], "❓ Core Question": "How do I price?", "✍ Description": "Two offers", "⚙️ Solution Attempts": "Asked around", "❓ Anything Else": "Soon", "📌 Type": "Pricing", "📊 Status": "No show" }, "2024-01-10T10:00:00.000Z");
    const p = buildBackfill({ feedback: [], support: [now, old], emails }, members, { feedbackMonths: new Set(), oohIds: new Set(["recO1"]) });
    expect(p.ooh).toEqual([
      expect.objectContaining({ recordId: "recO2", userId: "u1", friday: "2024-01-10", description: "Two offers\n\nAnything else: Soon", goal: "How do I price?", triedSelf: "Asked around", category: "Pricing", outcome: "no_show", status: "new", createdAt: "2024-01-10 10:00:00" }),
      expect.objectContaining({ recordId: "recO1", userId: "u2", friday: "2026-09-26", description: "The funnel breaks", goal: "A working funnel", tools: "GoHighLevel\nZapier", category: "Funnels", outcome: "covered", responsible: "Danno Hanfling", coachNotes: "Fixed live\n\nLoom: https://loom.com/x", status: "already" }),
    ]);
    expect(backfillSummary(p)).toEqual({ feedbackNew: 0, feedbackAlready: 0, oohNew: 1, oohAlready: 1, skipped: 0, improveLeft: 0, members: 1 });
  });
  it("reads categories and outcomes without guessing", () => {
    expect(oohCategory("FB group management")).toBe("FB Group Management");
    expect(oohCategory("")).toBe("Other");
    expect(oohOutcome("In progress")).toBeNull();
  });
});
