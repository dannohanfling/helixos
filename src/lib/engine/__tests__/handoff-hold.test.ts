import { describe, expect, it } from "vitest";
import { HOLD_LABEL, decidable, holdReason, labelledTitle } from "../handoff";

describe("HOLD and SUPERSEDED on inbox posts (H-351)", () => {
  it("a held or superseded post can't be decided, and says why in Danno's words", () => {
    expect(decidable({ held: null, supersededBy: null })).toEqual({ ok: true });
    expect(decidable({ held: { reason: "waiting on your H-336 decision", at: "2026-10-16T15:00:00Z" }, supersededBy: null })).toEqual({ ok: false, text: "This post is on hold: waiting on your H-336 decision" });
    expect(decidable({ held: null, supersededBy: "H-350" })).toEqual({ ok: false, text: "This was replaced by H-350." });
    // Superseded wins over a hold: the newer post is where the decision lives.
    expect(decidable({ held: { reason: "x", at: "" }, supersededBy: "H-9" }).ok).toBe(false);
  });
  it("the label goes at the front of the title, once, and the old typed prefixes are not repeated", () => {
    expect(labelledTitle("Ready to merge PR #18", { held: { reason: "r", at: "" }, supersededBy: null })).toBe(`${HOLD_LABEL} Ready to merge PR #18`);
    expect(labelledTitle("HOLD, don't approve yet: PR #18 needs a rebase", { held: { reason: "r", at: "" }, supersededBy: null })).toBe(`${HOLD_LABEL} PR #18 needs a rebase`);
    expect(labelledTitle("REPLACES H-243: PR #8 ready", { held: null, supersededBy: "H-400" })).toBe("SUPERSEDED by H-400 · PR #8 ready");
    expect(labelledTitle("Plain", { held: null, supersededBy: null })).toBe("Plain");
  });
  it("a hold needs a reason, one line", () => {
    expect(holdReason("  waiting on\n H-336 ")).toBe("waiting on H-336");
    expect(holdReason("")).toBeNull();
    expect(holdReason(undefined)).toBeNull();
    expect(holdReason("x".repeat(500))!.length).toBe(200);
  });
});
