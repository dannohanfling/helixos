import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE, SAMPLE_REWARDS, SAMPLE_ROWS, SAMPLE_TIERS, buildFeed, displayName, feedIsClean, feedSlug, fieldNames, mergeCustomers, pageConfigFromForm, pageMembersText, pageModel, parseExport, readHidden, readPageConfig, readPassUrl, readRewards, readTiers, textIsClean, tierFor } from "../leaderboard";

/** Christian's Kindness Koin leaderboard (rev 639, H-29): first name and initial, points and tier, and nothing that reaches a person. */
const customers = [
  { id: "c1", first_name: "maria jose", last_name: "santos", email: "maria@example.com", phone: "+15551234567", points_earned: 2450, points_balance: 900, membership_tier: "Gold", is_active: true, serial: "SER123", pass_url: "https://pass/x" },
  { id: "c2", first_name: "Ben", last_name: "O'Neil", email: "ben@example.com", points_earned: 300, points_balance: 300, membership_tier: null, is_active: true },
  { id: "c3", first_name: "Ina", last_name: "", points_earned: 900, points_balance: 10, is_active: true },
  { id: "c4", first_name: "Old", last_name: "Member", points_earned: 5000, points_balance: 0, is_active: false },
  { id: "c5", first_name: "Zero", last_name: "Points", points_earned: 0, points_balance: 0, is_active: true },
  { id: "c6", first_name: "john", last_name: "DOE", points_earned: 100, points_balance: 100, is_active: true },
  { id: "c7", first_name: "Testy", last_name: "McTest", points_earned: 100, points_balance: 100, is_active: true },
  { id: "c7b", first_name: "Honest", last_name: "Tester", points_earned: 100, points_balance: 100, is_active: true },
  { id: "c8", first_name: "Hidden", last_name: "Person", points_earned: 800, points_balance: 800, is_active: true },
];
const gates = { tiers: [{ name: "Bronze", min: 0 }, { name: "Silver", min: 500 }, { name: "Gold", min: 2000 }], showZero: false };

describe("leaderboard feed", () => {
  it("maps a customer to its public row, with the tier from config by lifetime points, and drops everything else", () => {
    expect(displayName("maria jose", "santos")).toBe("Maria S.");
    expect(displayName("BEN", "o'neil")).toBe("Ben O.");
    expect(displayName("Ina", "")).toBe("Ina");
    expect(displayName("", "Smith")).toBeNull();
    const feed = buildFeed(customers, ["c8"], "2026-10-10T12:00:00.000Z", gates);
    expect(feed).toEqual({
      updated_at: "2026-10-10T12:00:00.000Z",
      members: [
        { name: "Maria S.", lifetime: 2450, available: 900, tier: "Gold" },
        { name: "Ina", lifetime: 900, available: 10, tier: "Silver" },
        { name: "Ben O.", lifetime: 300, available: 300, tier: "Bronze" },
      ],
    });
    // eLoyalty's membership_tier is never read: Maria's "Gold" above came from the gates, and with no gates the tier is blank.
    expect(buildFeed(customers, [], "x", { tiers: [], showZero: false }).members[0].tier).toBe("");
  });

  it("leaves out the inactive, hidden, the John Doe placeholder in any case and any name with test in it; zero lifetime by the switch", () => {
    const names = buildFeed(customers, ["c8"], "x", gates).members.map((m) => m.name);
    for (const gone of ["Old M.", "Zero P.", "John D.", "Testy M.", "Honest T.", "Hidden P."]) expect(names).not.toContain(gone);
    expect(buildFeed(customers, [], "x", gates).members.map((m) => m.name)).toContain("Hidden P.");
    // Shown by default since H-33: members with 0 points are on the board, last, with the first gate.
    const shown = buildFeed(customers, [], "x", { ...gates, showZero: true }).members;
    expect(shown.at(-1)).toEqual({ name: "Zero P.", lifetime: 0, available: 0, tier: "Bronze" });
    expect(DEFAULT_PAGE.showZero).toBe(true);
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

  it("two templates during a pass move merge by customer id, nobody twice", () => {
    const a = [{ id: "c1", first_name: "A" }, { id: "c2", first_name: "B" }];
    const b = [{ id: "c2", first_name: "B again" }, { id: "c3", first_name: "C" }];
    expect(mergeCustomers([a, b]).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(mergeCustomers([a, b])[1].first_name).toBe("B");
  });
});

describe("tiers from config", () => {
  it("the highest gate at or below the lifetime total, and the next one; exactly at a gate counts as reached", () => {
    expect(tierFor(0, gates.tiers)).toEqual({ cur: gates.tiers[0], next: gates.tiers[1] });
    expect(tierFor(499, gates.tiers)).toEqual({ cur: gates.tiers[0], next: gates.tiers[1] });
    expect(tierFor(500, gates.tiers)).toEqual({ cur: gates.tiers[1], next: gates.tiers[2] });
    expect(tierFor(2000, gates.tiers)).toEqual({ cur: gates.tiers[2], next: null });
    expect(tierFor(10, [{ name: "Only", min: 100 }])).toEqual({ cur: null, next: { name: "Only", min: 100 } });
    expect(tierFor(10, [])).toEqual({ cur: null, next: null });
  });
  it("reads the editor's tiers and rewards: named, sorted, once per threshold, at most nine tiers and twenty rewards", () => {
    expect(readTiers("Gold, 2000\nBronze,0\n Silver | 500\nnonsense\nDup, 500\n, 7\nNoNumber, x")).toEqual([
      { name: "Bronze", min: 0 },
      { name: "Silver", min: 500 },
      { name: "Gold", min: 2000 },
    ]);
    expect(readTiers(Array.from({ length: 12 }, (_, i) => `T${i}, ${i * 10}`).join("\n"))).toHaveLength(9);
    expect(readRewards("Call | 1,200 | A private call\nAudio|100\nFree thing||No cost\n|5|nameless")).toEqual([
      { name: "Audio", cost: 100, desc: "" },
      { name: "Call", cost: 1200, desc: "A private call" },
      { name: "Free thing", cost: null, desc: "No cost" },
    ]);
    expect(readRewards(Array.from({ length: 25 }, (_, i) => `R${i}|${i}|`).join("\n"))).toHaveLength(20);
  });
});

describe("the page's settings", () => {
  it("default to the 9 Oct design's samples, marked Sample, and read back whatever is saved", () => {
    const d = readPageConfig(null);
    expect(d.tiers).toEqual(SAMPLE_TIERS);
    expect(d.rewards).toEqual(SAMPLE_REWARDS);
    expect(d.tiersSample && d.rewardsSample && d.showZero).toBe(true);
    expect(SAMPLE_TIERS).toHaveLength(9);
    expect(SAMPLE_TIERS[8]).toEqual({ name: "Gate 9", min: 3000 });
    expect(readPageConfig("not json").headline).toBe(d.headline);
    const saved = pageConfigFromForm({ headline: "Koin Board", headlineEm: "Board", eyebrow: "", tiers: "Seed, 0\nTree, 1000", rewards: "Hug | 10 | one", passUrl: "https://loyalty.example.com/pass-1785444472615", tiersSample: "", rewardsSample: "on", showZero: "" });
    const back = readPageConfig(JSON.stringify(saved));
    expect(back).toEqual(saved);
    expect(back).toMatchObject({ headline: "Koin Board", eyebrow: "", tiers: [{ name: "Seed", min: 0 }, { name: "Tree", min: 1000 }], rewards: [{ name: "Hug", cost: 10, desc: "one" }], tiersSample: false, rewardsSample: true, showZero: false, passUrl: "https://loyalty.example.com/pass-1785444472615" });
  });
  it("keeps only an https pass link", () => {
    expect(readPassUrl("https://loyalty.example.com/join")).toBe("https://loyalty.example.com/join");
    for (const bad of ["http://loyalty.example.com", "javascript:alert(1)", "loyalty.example.com", "https://x y", ""]) expect(readPassUrl(bad)).toBe("");
  });
});

describe("the pasted export", () => {
  const csv = ["First Name,Last Name,Email,Phone,Customer ID,Lifetime KK,Available KK,Status", "Maria,Santos,maria@example.com,+1 555 123 4567,cus_001,2450,900,", "John,Doe,jd@example.com,,cus_002,100,100,", "Tess,Tester,t@example.com,,cus_003,50,50,", "Hidden,Person,h@example.com,,cus_004,800,800,", "Ben,Okafor,ben@example.com,5550001234,cus_005,300,300,"].join("\n");
  it("keeps First L., lifetime and available, drops every other column, applies the hide list once and the same leave-out rules", () => {
    const { rows, hasAvailable, skipped } = parseExport(csv, ["cus_004"]);
    expect(rows).toEqual([
      { name: "Maria S.", lifetime: 2450, available: 900 },
      { name: "Ben O.", lifetime: 300, available: 300 },
    ]);
    expect(hasAvailable).toBe(true);
    expect(skipped).toBe(3);
    const text = JSON.stringify(rows);
    expect(textIsClean(text)).toBe(true);
    for (const bad of ["cus_", "@", "Santos", "Okafor", "555"]) expect(text).not.toContain(bad);
  });
  it("reads a single Name column, Redeemed as lifetime minus redeemed, and an active column", () => {
    const { rows, hasAvailable } = parseExport("Name,Points,Redeemed,Active\nAisha Patel,1105,700,yes\nOld Member,5000,0,false\n\"Chen, Robert\",10,0,yes");
    expect(rows).toEqual([
      { name: "Aisha P.", lifetime: 1105, available: 405 },
      { name: "Chen R.", lifetime: 10, available: 10 },
    ]);
    expect(hasAvailable).toBe(true);
    expect(parseExport("First,Last,Total\nA,B,5").rows).toEqual([{ name: "A B.", lifetime: 5, available: null }]);
    expect(parseExport("First,Last,Total\nA,B,5").hasAvailable).toBe(false);
  });
});

describe("the hosted page's model", () => {
  it("ranks with ties, works out tiers and the way to the next gate, the stats, the podium and who can redeem what", () => {
    const rows = [
      { name: "A", lifetime: 2450, available: 900 },
      { name: "B", lifetime: 500, available: 500 },
      { name: "C", lifetime: 500, available: 5 },
      { name: "D", lifetime: 0, available: 0 },
    ];
    const m = pageModel(rows, { ...DEFAULT_PAGE, tiers: gates.tiers, rewards: [{ name: "Call", cost: 600, desc: "" }, { name: "Audio", cost: 5, desc: "" }], showZero: true }, { kind: "live", at: "2026-10-13T12:00:00.000Z" });
    expect(m.members.map((x) => [x.name, x.rank, x.tier, x.toNext, x.pct])).toEqual([
      ["A", 1, "Gold", null, 100],
      ["B", 2, "Silver", 1500, 0],
      ["C", 2, "Silver", 1500, 0],
      ["D", 4, "Bronze", 500, 0],
    ]);
    expect(m.stats).toEqual({ members: 4, lifetime: 3450, available: 1405 });
    expect(m.podium.map((x) => x.name)).toEqual(["A", "B", "C"]);
    expect(m.rewards.map((r) => [r.name, r.canRedeem])).toEqual([
      ["Call", 1],
      ["Audio", 3],
    ]);
    expect(m.updatedLabel).toMatch(/^Live · updated Oct 13/);
    expect(pageModel(rows, { ...DEFAULT_PAGE, showZero: false }, { kind: "export", at: "9 Oct 2026" })).toMatchObject({ stats: { members: 3 }, updatedLabel: "Updated 9 Oct 2026" });
    expect(pageModel(rows, DEFAULT_PAGE, { kind: "sample" }).updatedLabel).toBe("");
  });
  it("the sample people are invented and clean, and the member text guard sees names and numbers only", () => {
    expect(SAMPLE_ROWS).toHaveLength(15);
    expect(SAMPLE_ROWS[0]).toEqual({ name: "Maria S.", lifetime: 2450, available: 900 });
    const m = pageModel(SAMPLE_ROWS, { ...DEFAULT_PAGE, passUrl: "https://loyalty.example.com/pass-1785444472615" }, { kind: "sample" });
    expect(textIsClean(pageMembersText(m))).toBe(true);
    expect(pageMembersText(m)).not.toContain("1785444472615");
  });
});
