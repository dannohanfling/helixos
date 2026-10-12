import { describe, expect, it } from "vitest";
import { groupRating } from "../groups";

describe("a group's star rating (rev 843 item 5)", () => {
  it("is a whole number from 1 to 5 or none, so the Groups page never draws a negative row of stars", () => {
    expect(groupRating(-1)).toBeNull();
    expect(groupRating(0)).toBeNull();
    expect(groupRating(null)).toBeNull();
    expect(groupRating(Number.NaN)).toBeNull();
    expect(groupRating(3.4)).toBe(3);
    expect(groupRating(9)).toBe(5);
    expect(() => "⭐".repeat(groupRating(-7) ?? 0)).not.toThrow();
  });
});
