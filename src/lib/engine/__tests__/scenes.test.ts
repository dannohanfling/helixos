import { describe, expect, it } from "vitest";
import { CLOSE_SCENE_WINDOW_MS, RANK_COUNT, closeSceneFor, rankCard, rankUpFor, roman, tomorrowLine } from "../scenes";
import { TIERS, tierFor } from "../tiers";

describe("the rank-up ceremony (H-327 §1)", () => {
  it("shows once per rank, the highest of several crossed at once, never Artisan, nothing until the seen rank is recorded", () => {
    expect(rankUpFor(120, 1)?.name).toBe("Philosopher");
    // One open after a coach adjustment from Artisan to Sage: only Sage.
    expect(rankUpFor(600, 1)?.name).toBe("Sage");
    expect(rankUpFor(600, 3)).toBeNull();
    expect(rankUpFor(600, 5)).toBeNull();
    expect(rankUpFor(50, 0)).toBeNull();
    expect(rankUpFor(120, null)).toBeNull();
  });
  it("the card: the eyebrow in numerals, the points passed, the seat, the ladder with the new rank lit, the next rank and the bar", () => {
    const sage = rankCard(tierFor(540), 540);
    expect(sage.eyebrow).toBe(`New rank · III of ${roman(RANK_COUNT)}`);
    expect(RANK_COUNT).toBe(9);
    expect(sage.line).toBe("You've passed 500 points. Your seat moves up to the upper stands of the Colosseum.");
    expect(sage.pips).toEqual(["done", "done", "now", "next", "next", "next", "next", "next", "next"]);
    expect(sage.ends).toEqual(["Artisan", "Olympian"]);
    expect(sage.next).toEqual({ name: "Alchemist", points: 1500, toGo: 960, pct: 4 });
    expect(sage.nextLine).toBe("Next: Alchemist at 1,500");
    expect(sage.slug).toBe("sage");
    // Philosopher sits on the same ring as Artisan: the seat keeps its place.
    expect(rankCard(tierFor(100), 100).line).toBe("You've passed 100 points. Your seat keeps its place in the top tier of the Colosseum.");
    // The top: no next rank.
    const top = rankCard(TIERS[TIERS.length - 1], 61000);
    expect(top.next).toBeNull();
    expect(top.pips.at(-1)).toBe("now");
    expect(top.summary).toContain("Olympian");
  });
});

describe("the evening close (H-327 §2)", () => {
  const ladder = new Set(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
  it("the line about tomorrow comes from the streak engine's own rule", () => {
    // 2026-10-16 is a Friday: Saturday pays the weekend's +40 for a member whose every day counts.
    expect(tomorrowLine("2026-10-16", "all", ladder)).toBe("Tomorrow is Saturday: +40 for showing up.");
    expect(tomorrowLine("2026-10-16", "weekdays", ladder)).toBe("Tomorrow is Saturday. Your fire rests until Monday.");
    // A Monday close: Tuesday is streak day 2.
    expect(tomorrowLine("2026-10-12", "all", new Set())).toMatch(/^Tomorrow is Tuesday: \+\d+ for showing up \(streak day 2\)\.$/);
  });
  it("plays once per close, keyed on the close's ledger row, within ten minutes of it, with that row's credit", () => {
    const now = Date.parse("2026-10-16T22:30:00Z");
    const row = { id: "led_1", points: 20, createdAt: "2026-10-16 22:29:40" };
    const scene = closeSceneFor({ row, now, day: "2026-10-16", streak: 12, days: "all", ladder });
    expect(scene).toMatchObject({ id: "led_1", credit: 20, eyebrow: "Day closed", title: "The arena is lit.", creditLine: "+20 for closing out the day" });
    expect(scene!.line).toBe("Every lamp is yours tonight. Your 12-day fire carries into tomorrow.");
    expect(closeSceneFor({ row, now, day: "2026-10-16", streak: 1, days: "all", ladder })!.line).toBe("Every lamp is yours tonight. Your fire is lit for tomorrow.");
    expect(closeSceneFor({ row: null, now, day: "2026-10-16", streak: 12, days: "all", ladder })).toBeNull();
    expect(closeSceneFor({ row, now: now + CLOSE_SCENE_WINDOW_MS + 60_000, day: "2026-10-16", streak: 12, days: "all", ladder })).toBeNull();
  });
});
