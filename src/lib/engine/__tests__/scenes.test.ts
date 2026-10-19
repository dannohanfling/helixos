import { describe, expect, it } from "vitest";
import { CLIPS_LIVE_AT, CLOSE_SCENE_WINDOW_MS, RANK_COUNT, catchUpCard, catchUpFor, closeSceneFor, rankCard, rankUpFor, roman, tomorrowLine } from "../scenes";
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

describe("the catch-up ceremony (H-934, plan H-942)", () => {
  const sage = TIERS.find((t) => t.name === "Sage")!;
  const at = sage.minPoints + 10;
  const before = "2026-10-12 09:00:00";
  const after = "2026-10-18 16:30:00";
  const base = { points: at, celebrated: sage.level, clipSeen: null, reachedAt: before };

  it("plays the current rank's clip for a rank reached before the clips went live", () => {
    expect(catchUpFor(base)).toEqual({ kind: "play", tier: sage });
    // The ledger can't say when: read as before.
    expect(catchUpFor({ ...base, reachedAt: null })).toEqual({ kind: "play", tier: sage });
    expect(catchUpFor({ ...base, clipSeen: sage.level - 1 })).toMatchObject({ kind: "play" });
  });

  it("stamps silently a rank reached after the clips went live: its clip played then", () => {
    expect(catchUpFor({ ...base, reachedAt: after })).toEqual({ kind: "stamp", level: sage.level });
    expect(catchUpFor({ ...base, reachedAt: CLIPS_LIVE_AT })).toEqual({ kind: "stamp", level: sage.level });
  });

  it("reads both forms of a ledger time on the clips' own day", () => {
    // ISO and datetime('now') stamps of the same hours: earlier is before whatever the form, later is after.
    expect(catchUpFor({ ...base, reachedAt: "2026-10-18T03:00:00.000Z" })).toMatchObject({ kind: "play" });
    expect(catchUpFor({ ...base, reachedAt: "2026-10-18 03:00:00" })).toMatchObject({ kind: "play" });
    expect(catchUpFor({ ...base, reachedAt: "2026-10-18T06:00:00.000Z" })).toMatchObject({ kind: "stamp" });
    expect(catchUpFor({ ...base, reachedAt: "2026-10-18 06:00:00" })).toMatchObject({ kind: "stamp" });
  });

  it("nothing once seen, for an Artisan, before any rank is recorded, or while a normal rank-up is due", () => {
    expect(catchUpFor({ ...base, clipSeen: sage.level })).toBeNull();
    expect(catchUpFor({ ...base, points: 0, celebrated: 1 })).toBeNull();
    expect(catchUpFor({ ...base, celebrated: null })).toBeNull();
    // Sage reached, Philosopher the last celebrated: the normal rank-up plays its own clip instead.
    expect(rankUpFor(at, sage.level - 1)).not.toBeNull();
    expect(catchUpFor({ ...base, celebrated: sage.level - 1 })).toBeNull();
  });

  it("the card opens on the relic and keeps the rank's own line", () => {
    const plain = rankCard(sage, at);
    const late = catchUpCard(sage, at);
    expect(late.line).toBe(`Your relic is here. ${plain.line}`);
    expect(late.pre).toBe("You have risen to");
    expect(late.name).toBe("Sage");
    expect(late.summary).toContain("Your relic is here.");
    expect({ ...late, line: plain.line, summary: plain.summary }).toEqual(plain);
  });
});
