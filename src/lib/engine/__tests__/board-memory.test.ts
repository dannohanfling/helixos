import { describe, expect, it } from "vitest";
import { beforeFreshStart, canUndoFreshStart, dbStamp, discussionTags, inMemory, matchesSearch, PAGE, pageOf } from "@/lib/engine/board-memory";

const d = (createdAt: string, extra: Partial<{ remembered: boolean; example: boolean }> = {}) => ({ createdAt, remembered: true, example: false, ...extra });

describe("My Board's memory (H-257)", () => {
  it("reads a remembered, non-example decision; leaves out a not-remembered one and an example", () => {
    expect(inMemory(d("2026-10-10 09:00:00"), null)).toBe(true);
    expect(inMemory(d("2026-10-10 09:00:00", { remembered: false }), null)).toBe(false);
    expect(inMemory(d("2026-10-10 09:00:00", { example: true }), null)).toBe(false);
  });
  it("after Start fresh reads only decisions made after the stamp; Undo (no stamp) brings the earlier ones back", () => {
    const fresh = "2026-10-15 20:00:00";
    expect(inMemory(d("2026-10-15 19:59:59"), fresh)).toBe(false);
    expect(inMemory(d("2026-10-15 20:00:00"), fresh)).toBe(false);
    expect(inMemory(d("2026-10-15 20:00:01"), fresh)).toBe(true);
    expect(beforeFreshStart(d("2026-10-15 19:59:59"), fresh)).toBe(true);
    expect(beforeFreshStart(d("2026-10-15 19:59:59"), null)).toBe(false);
    expect(inMemory(d("2026-10-15 19:59:59"), null)).toBe(true);
  });
  it("stamps in the database's own shape so the stamps compare as strings", () => {
    expect(dbStamp(new Date("2026-10-15T20:44:05.123Z"))).toBe("2026-10-15 20:44:05");
  });
  it("Undo stays seven days", () => {
    const fresh = "2026-10-15 20:00:00";
    expect(canUndoFreshStart(fresh, new Date("2026-10-15T20:00:01Z"))).toBe(true);
    expect(canUndoFreshStart(fresh, new Date("2026-10-22T19:59:59Z"))).toBe(true);
    expect(canUndoFreshStart(fresh, new Date("2026-10-22T20:00:00Z"))).toBe(false);
    expect(canUndoFreshStart(null, new Date())).toBe(false);
  });
  it("tags: Shared with coach, Example, Not remembered (an example never also says not remembered)", () => {
    expect(discussionTags({ sharedAt: null, remembered: true, example: false })).toEqual([]);
    expect(discussionTags({ sharedAt: "2026-10-15 10:00:00", remembered: false, example: false })).toEqual(["Shared with coach", "Not remembered"]);
    expect(discussionTags({ sharedAt: null, remembered: false, example: true })).toEqual(["Example"]);
  });
  it("search matches every word over the question, the decision and the recommendation", () => {
    const row = { question: "Run my first webinar this month, or put the time into DMs?", answer: { decision: "Webinar or DMs", recommendation: "Put the month into DMs; the webinar waits." } };
    expect(matchesSearch(row, "")).toBe(true);
    expect(matchesSearch(row, "webinar")).toBe(true);
    expect(matchesSearch(row, "month waits")).toBe(true);
    expect(matchesSearch(row, "podcast")).toBe(false);
    expect(matchesSearch({ question: "Price?", answer: null }, "price")).toBe(true);
  });
  it("pages 20 at a time, More only while rows remain", () => {
    const rows = Array.from({ length: 45 }, (_, i) => i);
    expect(pageOf(rows, 0)).toEqual({ rows: rows.slice(0, PAGE), more: true });
    expect(pageOf(rows, 40)).toEqual({ rows: rows.slice(0, 40), more: true });
    expect(pageOf(rows, 60)).toEqual({ rows, more: false });
    expect(pageOf([1, 2], 20)).toEqual({ rows: [1, 2], more: false });
  });
});
