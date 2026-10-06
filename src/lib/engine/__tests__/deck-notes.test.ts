import { describe, expect, it } from "vitest";
import { figureClashes, matchPoints, sentences, talkLines, talkTrack, type TalkSlide } from "../deck-notes";

const sec = (script: string | null, durationMin = 6, startMin = 10) => ({ sectionKey: "hook", name: "Hook", script, durationMin, startMin });
const slide = (n: number, headline: string, body: string[] = [], sectionKey: string | null = "hook"): TalkSlide => ({ n, sectionKey, headline, body });

describe("deck layouts 14: the talk track", () => {
  it("splits a script into sentences on their ends and on line breaks, keeping a.m. and figures whole", () => {
    expect(sentences("I sent 600 DMs. Two booked!\nThen it changed… Why? Because at 2 a.m. I wrote $5,000.")).toEqual(["I sent 600 DMs.", "Two booked!", "Then it changed…", "Why?", "Because at 2 a.m. I wrote $5,000."]);
  });
  it("finds each point in the script in order, and none it never says", () => {
    const s = sentences("Welcome in. Most coaches post and pray. The fix is a conversation, not a post. Here is the first step. Send ten DMs today.");
    expect(matchPoints(["Coaches post and pray", "A conversation beats a post", "Ride a unicorn", "Send ten DMs today"], s)).toEqual([1, 2, null, 4]);
  });
  it("gives each slide the script from its point to the next point; the first takes the opening; an unsaid point takes the script from the point before", () => {
    const script = "Welcome in. Most coaches post and pray. The fix is a conversation, not a post. Here is the first step. Send ten DMs today.";
    const t = talkTrack([slide(3, "Coaches post and pray"), slide(4, "A conversation beats a post"), slide(5, "Ride a unicorn"), slide(6, "Send ten DMs today")], [sec(script)]);
    expect(t.get(3)!.say).toBe("Welcome in. Most coaches post and pray.");
    expect(t.get(4)!.say).toBe("The fix is a conversation, not a post. Here is the first step.");
    expect(t.get(5)!.say).toBe("The fix is a conversation, not a post. Here is the first step.");
    expect(t.get(6)!.say).toBe("Send ten DMs today.");
  });
  it("spreads the section's minutes over its slides, with the elapsed time at each slide's end", () => {
    const t = talkTrack([slide(3, "One"), slide(4, "Two"), slide(5, "Three"), slide(9, "Elsewhere", [], "other")], [sec(null, 6, 10)]);
    expect([...t.entries()]).toEqual([[3, { say: null, minutes: 2, endMin: 12 }], [4, { say: null, minutes: 2, endMin: 14 }], [5, { say: null, minutes: 2, endMin: 16 }]]);
    expect(talkLines(t.get(3)!)).toEqual(["Time: about 2 minutes on this slide; 12 minutes in at its end."]);
    expect(talkLines({ say: "Hi.", minutes: 0.5, endMin: 1 })).toEqual(["What to say: Hi.", "Time: about 0.5 minutes on this slide; 1 minute in at its end."]);
  });
  it("a build takes its point from its new line; a script that says none of the points is shared out in order", () => {
    const built = talkTrack([slide(3, "Three moves"), slide(4, "Three moves", ["Open the loop"]), slide(5, "Three moves", ["Open the loop", "Close it on the call"])], [sec("There are three moves. First you open the loop. Then you close it on the call.")]);
    expect([3, 4, 5].map((n) => built.get(n)!.say)).toEqual(["There are three moves.", "First you open the loop.", "Then you close it on the call."]);
    const none = talkTrack([slide(3, "Alpha"), slide(4, "Beta")], [sec("One thing. Two things. Three things. Four things.")]);
    expect([none.get(3)!.say, none.get(4)!.say]).toEqual(["One thing. Two things.", "Three things. Four things."]);
  });
});

describe("deck layouts 15: figures that disagree", () => {
  it("names the same thing with two close figures, each with where it sits; a progression is not a disagreement", () => {
    const clashes = figureClashes([
      { text: "My first $5,043 week", where: "slide 12" },
      { text: "I went from $1,500 then to a $5,000 week.", where: "the Origin script" },
      { text: "$1,500 week to $5,000 week in a year", where: "slide 30" },
    ]);
    expect(clashes).toEqual([{ unit: "week", figures: [{ text: "$5,043 week", where: "slide 12" }, { text: "$5,000 week", where: "the Origin script" }, { text: "$5,000 week", where: "slide 30" }] }]);
  });
  it("reads percentages and counts with their unit, and leaves small counts, durations and years alone", () => {
    expect(figureClashes([{ text: "98.2% opened", where: "slide 4" }, { text: "98% opened", where: "slide 9" }]).map((c) => c.figures.map((f) => f.text))).toEqual([["98.2% opened", "98% opened"]]);
    expect(figureClashes([{ text: "47 moms through the program", where: "slide 2" }, { text: "50 moms so far", where: "slide 8" }])[0].unit).toBe("mom");
    expect(figureClashes([{ text: "3 steps, then 4 steps", where: "slide 1" }, { text: "30 days, then 31 days", where: "slide 2" }, { text: "In 2023 I", where: "slide 3" }, { text: "In 2024 I", where: "slide 4" }])).toEqual([]);
    expect(figureClashes([{ text: "602 comments", where: "slide 1" }, { text: "602 comments again", where: "slide 5" }])).toEqual([]);
  });
});
