import { describe, expect, it } from "vitest";
import { ARRIVAL_MS, CLIENT_STEPS, TEAM_TILES, arrivalCard, arrivalDue, goldFlakes, teamTiles, wreathLeaves } from "../first-arrival";

describe("the first arrival (H-472)", () => {
  it("is due once: never seen; never while a coach is switched in; never on /coach pages", () => {
    expect(arrivalDue({ seenAt: null, switchedInto: false, path: "/today" })).toBe(true);
    expect(arrivalDue({ seenAt: "2026-10-17T01:00:00.000Z", switchedInto: false, path: "/today" })).toBe(false);
    expect(arrivalDue({ seenAt: null, switchedInto: true, path: "/today" })).toBe(false);
    expect(arrivalDue({ seenAt: null, switchedInto: false, path: "/coach" })).toBe(false);
    expect(arrivalDue({ seenAt: null, switchedInto: false, path: "/coach/abc" })).toBe(false);
  });
  it("the client's face: the words, the three tablets, Take my seat", () => {
    const c = arrivalCard({ kind: "client", first: "Maya" });
    expect(c).toMatchObject({ eyebrow: "Ave · Welcome to HelixOS", title: "Your seat is ready, Maya", chip: "Day 1 · Your first ember", button: "Take my seat", initial: "M", nameUp: "MAYA", replay: false });
    expect(c.tiles).toEqual(CLIENT_STEPS);
    expect(c.tiles.map((t) => `${t.numeral} ${t.href}`)).toEqual(["I /today#checkin", "II /my-board", "III /settings#you"]);
    expect(arrivalCard({ kind: "client", first: "" }).title).toBe("Your seat is ready, there");
  });
  it("the team face: the owner's name and initial, the TEAM tiles only for pages a team member can open, Office Hours only with the owner's access", () => {
    const t = arrivalCard({ kind: "team", first: "Sam", owner: "Jordan", oohOn: true });
    expect(t).toMatchObject({ eyebrow: "Ave · You've joined the team", title: "Welcome to Jordan's team, Sam", lead: "You're here to help Jordan's business grow. Here's what you can do.", chip: "Invited by Jordan", initial: "J", button: "Start helping" });
    expect(t.tiles.map((x) => x.href)).toEqual(["/content", "/conversations", "/tasks", "/webinars", "/office-hours"]);
    expect(t.tiles.at(-1)!.line).toBe("Join the calls Jordan books you on, shown in your time.");
    expect(teamTiles("Jordan", false).map((x) => x.href)).toEqual(["/content", "/conversations", "/tasks", "/webinars"]);
    // No ranks, streaks or points on the team face.
    expect(JSON.stringify(t)).not.toMatch(/Artisan|ember|points|streak/i);
    expect(TEAM_TILES.every((x) => ["/content", "/conversations", "/tasks", "/webinars", "/office-hours"].includes(x.href))).toBe(true);
  });
  it("the geometry is the design's and deterministic: 24 leaves a side by side, 22 flakes, the clock a little past the last shine", () => {
    const leaves = wreathLeaves();
    expect(leaves).toHaveLength(24);
    expect(leaves[0]).toEqual({ x: Number((84 + 66 * Math.cos((100 * Math.PI) / 180) - 5).toFixed(1)), y: Number((84 + 66 * Math.sin((100 * Math.PI) / 180) - 12).toFixed(1)), r: 118, delay: 2.45 });
    expect(wreathLeaves()).toEqual(leaves);
    const flakes = goldFlakes();
    expect(flakes).toHaveLength(22);
    expect(flakes.filter((f) => f.leaf)).toHaveLength(8);
    expect(goldFlakes()).toEqual(flakes);
    expect(ARRIVAL_MS).toBeGreaterThan(4700);
  });
});
