import { describe, expect, it } from "vitest";
import { champions, initials, LAP_SECONDS, onRing, readWin, RING_CAP, RINGS, seatAngle, seatPlace, seatRings, standings, TIER_RING, weekByDay, type Standing } from "../colosseum";

const row = (over: Partial<Standing> & { userId: string }): Standing => ({ membershipId: `m-${over.userId}`, name: `Member ${over.userId}`, points: 0, week: 0, tier: "Artisan", hidden: false, photo: false, isYou: false, ...over });

describe("the Colosseum (rev 699, rev 720): who stands where", () => {
  it("this week's top three stand on the sand, hidden members never, and nobody with no points this week", () => {
    const rows = [row({ userId: "a", week: 50, points: 100 }), row({ userId: "b", week: 80, points: 10 }), row({ userId: "c", week: 80, points: 900, hidden: true }), row({ userId: "d", week: 0, points: 5000 }), row({ userId: "e", week: 20 })];
    expect(champions(rows).map((c) => c.userId)).toEqual(["b", "a", "e"]);
  });
  it("every rank has a ring: Centurion and above in front, Alchemist and Sentinel next, Sage, then Artisan and Philosopher", () => {
    expect([TIER_RING.Olympian, TIER_RING.Centurion, TIER_RING.Sentinel, TIER_RING.Alchemist, TIER_RING.Sage, TIER_RING.Philosopher, TIER_RING.Artisan]).toEqual([0, 0, 1, 1, 2, 3, 3]);
  });
  it("a champion leaves their ring; a full ring keeps the top ones by points and counts the rest for '+N more'", () => {
    const many = Array.from({ length: RING_CAP + 5 }, (_, i) => row({ userId: `s${i}`, tier: "Sage", points: i }));
    const { rings, more } = seatRings([...many, row({ userId: "champ", tier: "Sage", points: 9, week: 99 })], [row({ userId: "champ" })]);
    expect(rings[2]).toHaveLength(RING_CAP);
    expect(rings[2][0].seat.userId).toBe(`s${RING_CAP + 4}`);
    expect(more).toEqual([0, 0, 5, 0]);
    expect(rings[2].some((s) => s.seat.userId === "champ")).toBe(false);
  });
  it("seats are spread evenly, each ring 23° further round, and stay on their ring's ellipse as the lap goes by", () => {
    const a0 = seatAngle(0, 0, 4, 0);
    const a1 = seatAngle(0, 1, 4, 0);
    expect(a1 - a0).toBeCloseTo(Math.PI / 2, 6);
    expect(seatAngle(1, 0, 4, 0) - a0).toBeCloseTo((23 * Math.PI) / 180, 6);
    for (const ring of [0, 1, 2, 3]) for (const t of [0, 7, 33, LAP_SECONDS[ring] / 2, LAP_SECONDS[ring]]) expect(onRing(ring, seatPlace(ring, seatAngle(ring, 2, 9, t)))).toBe(true);
    expect(seatAngle(3, 0, 1, LAP_SECONDS[3]) - seatAngle(3, 0, 1, 0)).toBeCloseTo(2 * Math.PI, 6);
  });
  it("depth: smaller at the back of the ellipse, larger at the front", () => {
    expect(seatPlace(0, -Math.PI / 2).scale).toBeCloseTo(0.82, 2);
    expect(seatPlace(0, Math.PI / 2).scale).toBeCloseTo(1.05, 2);
    expect(RINGS[0].ry).toBeLessThan(RINGS[3].ry);
  });
  it("standings: all-time first, hidden members out, one tier when filtered; initials from a name", () => {
    const rows = [row({ userId: "a", points: 10, tier: "Sage" }), row({ userId: "b", points: 30, hidden: true }), row({ userId: "c", points: 20, tier: "Sage" })];
    expect(standings(rows).map((r) => r.userId)).toEqual(["c", "a"]);
    expect(standings(rows, "Artisan")).toEqual([]);
    expect(initials("Leo Tanaka")).toBe("LT");
    expect(initials("priya")).toBe("PR");
  });
  it("My week: Mon to Sun from the ledger's days; a shared win is plain text with no email or phone", () => {
    const week = weekByDay([{ points: 5, day: "2026-10-06" }, { points: 7, day: "2026-10-06" }, { points: 3, day: "2026-10-12" }, { points: 9, day: "2026-10-13" }], "2026-10-06");
    expect(week.map((d) => d.points)).toEqual([12, 0, 0, 0, 0, 0, 3]);
    expect(readWin("business", " Three calls booked  from one post ")).toEqual({ ok: true, kind: "business", text: "Three calls booked from one post" });
    expect(readWin("business", "mail me at sam@example.com").ok).toBe(false);
    expect(readWin("party", "x").ok).toBe(false);
  });
});
