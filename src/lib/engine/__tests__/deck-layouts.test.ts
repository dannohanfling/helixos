import { describe, expect, it } from "vitest";
import { bigNumbers, isCardList, shiftFrom } from "../deck-layouts";

describe("deck layouts 1: the big number", () => {
  it("one figure: the number, and the words after it as its label (the whole line when fewer than two follow)", () => {
    expect(bigNumbers("602 comments on my post in 48 hours")).toEqual([{ value: "602", label: "comments on my post in 48 hours" }]);
    expect(bigNumbers("We hit $114,400 in launch revenue.")).toEqual([{ value: "$114,400", label: "in launch revenue" }]);
    expect(bigNumbers("Open rates climbed to 47%")).toEqual([{ value: "47%", label: "Open rates climbed to 47%" }]);
  });
  it("two or three figures: a row, each with the words that say what it counts", () => {
    expect(bigNumbers("1,838 sent, 98.2% opened")).toEqual([{ value: "1,838", label: "sent" }, { value: "98.2%", label: "opened" }]);
  });
  it("a duration is never the figure, and a line with none (or more than three) is no big number", () => {
    expect(bigNumbers("Give it 30 days")).toBeNull();
    expect(bigNumbers("Most leaders never name the drift.")).toBeNull();
    expect(bigNumbers("1 sent, 2 opened, 3 booked, 4 clients")).toBeNull();
  });
});

describe("deck layouts 3 and 11: cards and the shift", () => {
  it("2 to 4 short, parallel lines make cards; one long line or a lopsided list does not", () => {
    expect(isCardList(["A plan for your first 30 days", "A script for every DM", "A number to hit each week"])).toBe(true);
    expect(isCardList(["Only one"])).toBe(false);
    expect(isCardList(["Short", "A much, much longer line that runs on and on and on past any card"])).toBe(false);
    expect(isCardList(["a", "b", "c", "d", "e"])).toBe(false);
  });
  it("a divider with its From line takes the From → To layout", () => {
    expect(shiftFrom(["From: I need more followers"])).toBe("I need more followers");
    expect(shiftFrom([])).toBeNull();
  });
});
