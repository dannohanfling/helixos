import { describe, expect, it } from "vitest";
import { buildFeed, displayName, feedIsClean, feedSlug, fieldNames, readHidden } from "../leaderboard";

/** Christian's Kindness Koin leaderboard (rev 639): first name and initial, points and tier, and nothing that reaches a person. */
const customers = [
  { id: "c1", first_name: "maria jose", last_name: "santos", email: "maria@example.com", phone: "+15551234567", points_earned: 2450, points_balance: 900, membership_tier: "Gold", is_active: true, serial: "SER123", pass_url: "https://pass/x" },
  { id: "c2", first_name: "Ben", last_name: "O'Neil", email: "ben@example.com", points_earned: 300, points_balance: 300, membership_tier: null, is_active: true },
  { id: "c3", first_name: "Ina", last_name: "", points_earned: 900, points_balance: 10, is_active: true },
  { id: "c4", first_name: "Old", last_name: "Member", points_earned: 5000, points_balance: 0, is_active: false },
  { id: "c5", first_name: "Zero", last_name: "Points", points_earned: 0, points_balance: 0, is_active: true },
  { id: "c6", first_name: "John", last_name: "Doe", points_earned: 100, points_balance: 100, is_active: true },
  { id: "c7", first_name: "Testy", last_name: "McTest", points_earned: 100, points_balance: 100, is_active: true },
  { id: "c8", first_name: "Hidden", last_name: "Person", points_earned: 800, points_balance: 800, is_active: true },
];

describe("leaderboard feed", () => {
  it("maps a customer to its public row and drops everything else", () => {
    expect(displayName("maria jose", "santos")).toBe("Maria S.");
    expect(displayName("BEN", "o'neil")).toBe("Ben O.");
    expect(displayName("Ina", "")).toBe("Ina");
    expect(displayName("", "Smith")).toBeNull();
    const feed = buildFeed(customers, ["c8"], "2026-10-10T12:00:00.000Z");
    expect(feed).toEqual({
      updated_at: "2026-10-10T12:00:00.000Z",
      members: [
        { name: "Maria S.", lifetime: 2450, available: 900, tier: "Gold" },
        { name: "Ina", lifetime: 900, available: 10, tier: "" },
        { name: "Ben O.", lifetime: 300, available: 300, tier: "" },
      ],
    });
  });

  it("leaves out the inactive, zero lifetime, hidden, the John Doe placeholder and any test name", () => {
    const names = buildFeed(customers, ["c8"], "x").members.map((m) => m.name);
    for (const gone of ["Old M.", "Zero P.", "John D.", "Testy M.", "Hidden P."]) expect(names).not.toContain(gone);
    expect(buildFeed(customers, [], "x").members.map((m) => m.name)).toContain("Hidden P.");
  });

  it("never carries an email, a phone-like number, a full last name, an id, a serial or a pass link", () => {
    const text = JSON.stringify(buildFeed(customers, [], "x"));
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\d{7,}/);
    for (const bad of ["santos", "O'Neil", "c1", "SER123", "https://pass", "example.com"]) expect(text).not.toContain(bad);
    expect(feedIsClean(buildFeed(customers, [], "x"))).toBe(true);
    expect(feedIsClean({ updated_at: "x", members: [{ name: "a@b", lifetime: 1, available: 1, tier: "" }] })).toBe(false);
    expect(feedIsClean({ updated_at: "x", members: [{ name: "A", lifetime: 12345678, available: 1, tier: "" }] })).toBe(false);
  });

  it("reads the hide list, names the fields seen (never values) and makes a feed address", () => {
    expect(readHidden(" c1\nc2,c2\n\nnot valid!\n")).toEqual(["c1", "c2"]);
    expect(fieldNames(customers[0])).toEqual(["email", "first_name", "id", "is_active", "last_name", "membership_tier", "pass_url", "phone", "points_balance", "points_earned", "serial"]);
    expect(feedSlug("Christian Raphael Hypnotherapy", "k3f9q2")).toBe("christian-raphael-hypnotherapy-k3f9q2");
    expect(feedSlug("!!!", "a1")).toBe("leaderboard-a1");
  });
});
