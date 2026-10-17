import { describe, expect, it } from "vitest";
import { type ClColumns, ID_REPORT_COLUMNS, compare, countsLine, idReportCsv, latestChange, parseClExport, passHolders, snapshotIsClean, suggestion } from "../points-check";

/** The points check (H-102, H-112), on invented people: eLoyalty's passes against a Community Loyalty export, in memory, names as First L. only. */
const customers = [
  { id: "11111111-aaaa-4bbb-8ccc-000000000001", first_name: "Maria", last_name: "Santos", email: "maria@example.com", pass_serial_number: "wp-1757900000001-aaa", points_balance: 700, points_earned: 900, template_id: "89fd70bc-legacy", is_active: true },
  { id: "11111111-aaaa-4bbb-8ccc-000000000002", first_name: "Ben", last_name: "Okafor", email: "ben@example.com", pass_serial_number: "wp-1757900000002-bbb", points_balance: 650, points_earned: 650, template_id: "89fd70bc-legacy", is_active: true },
  { id: "11111111-aaaa-4bbb-8ccc-000000000003", first_name: "Ina", last_name: "Lund", email: "ina@example.com", pass_serial_number: "wp-1757900000003-ccc", points_balance: 1600, points_earned: 1600, template_id: "bc3fe237-2026", is_active: true },
  { id: "11111111-aaaa-4bbb-8ccc-000000000004", first_name: "Rafa", last_name: "Diaz", email: "rafa@example.com", pass_serial_number: "wp-1757900000004-ddd", points_balance: 500, points_earned: 500, template_id: "89fd70bc-legacy", is_active: true },
  { id: "11111111-aaaa-4bbb-8ccc-000000000005", first_name: "Deb", last_name: "Coach", email: "deb@example.com", pass_serial_number: "wp-1757900000005-eee", points_balance: 50, points_earned: 50, template_id: "89fd70bc-legacy", is_active: true },
  { id: "11111111-aaaa-4bbb-8ccc-000000000006", first_name: "John", last_name: "Doe", email: "jd@example.com", pass_serial_number: "wp-1757900000006-fff", points_balance: 0, points_earned: 0, template_id: "89fd70bc-legacy", is_active: true },
];
const csv = [
  "User NS,First Name,Last Name,Email,Impact Pass - Serial Number,Loyalty Customer ID,CL Points Balance,Kindness Koins Bank,Points to Send",
  "f159927u1,Maria,Santos,maria@example.com,wp-1757900000001-aaa,11111111-aaaa-4bbb-8ccc-000000000001,650,500,",
  "f159927u2,Ben,Okafor,ben@example.com,wp-1757900000002-bbb,,650,500,",
  "f159927u3,Ina,Lund,ina.other@example.com,,11111111-aaaa-4bbb-8ccc-000000000003,1600,650,10",
  "f159927u4,Guest,,,wp-1757900000099-zzz,,,500,",
  "f159927u5,Hannah,Lee,hannah@example.com,,,,500,",
  "f159927u6,Peter,Walsh,peter@example.com,wp-1757900000077-ppp,,,500,",
  "f159927u7,Rafa,Diaz,rafa@example.com,,,,500,",
].join("\n");

describe("the Community Loyalty export", () => {
  it("keeps only pass-linked bot users, by the columns' meaning, and reads the two points fields apart", () => {
    const { records, columns, rows } = parseClExport(csv);
    expect(rows).toBe(7);
    expect(columns).toEqual<ClColumns>({ customerId: true, serial: true, clBalance: true, kkBank: true, pointsToSend: true, name: true, email: true });
    // Hannah has neither a serial nor a customer id: not pass-linked, read past. Rafa too (email only).
    expect(records.map((r) => r.name)).toEqual(["Maria S.", "Ben O.", "Ina L.", "Guest", "Peter W."]);
    expect(records[0]).toMatchObject({ customerId: "11111111-aaaa-4bbb-8ccc-000000000001", serial: "wp-1757900000001-aaa", clBalance: 650, kkBank: 500, pointsToSend: null });
    expect(records[2]).toMatchObject({ clBalance: 1600, kkBank: 650, pointsToSend: 10 });
    expect(records[3]).toMatchObject({ clBalance: null, kkBank: 500 });
  });
  it("tells a missing key column", () => {
    expect(parseClExport("Name,Points\nA B,5").columns).toMatchObject({ customerId: false, serial: false });
  });
});

describe("eLoyalty's events", () => {
  it("picks the newest points change and says who made it in kind words, never a person's name", () => {
    const events = {
      data: [
        { type: "points_added", points: 100, created_at: "2026-10-01T10:00:00Z", source: "api_key", created_by: { name: "GHL Integration" } },
        { type: "points_adjusted", points: -50, created_at: "2026-10-05T09:00:00Z", source: "portal", created_by: { name: "A Real Person", email: "person@example.com" } },
        { type: "check_in", created_at: "2026-10-09T09:00:00Z", source: "automation" },
      ],
    };
    const last = latestChange(events);
    expect(last).toEqual({ at: "2026-10-05T09:00:00.000Z", amount: -50, by: "team (portal)", kind: "points_adjusted" });
    expect(JSON.stringify(last)).not.toContain("Real Person");
    expect(latestChange({ data: [] })).toBeNull();
    expect(latestChange(null)).toBeNull();
    expect(latestChange([{ event_type: "earn", amount: "25", timestamp: "2026-09-01T00:00:00Z", actor_type: "scanner" }])).toMatchObject({ amount: 25, by: "automation" });
  });
});

describe("the comparison", () => {
  const holders = passHolders(customers);
  const { records, columns } = parseClExport(csv);
  const hidden = new Set(["11111111-aaaa-4bbb-8ccc-000000000005"]);
  const history = new Map([
    ["11111111-aaaa-4bbb-8ccc-000000000001", { at: "2026-10-05T09:00:00.000Z", amount: 50, by: "team (portal)" as const, kind: "points_adjusted" }],
    ["11111111-aaaa-4bbb-8ccc-000000000003", null],
  ]);
  const snap = compare(holders, records, hidden, history, { at: "2026-10-15T00:00:00.000Z", templates: ["89fd70bc-legacy", "bc3fe237-2026"], columns, clRows: 7, note: "6 histories read." });

  it("matches by customer id, then serial, then email; suggests eLoyalty's number with the reason; counts the hide list apart", () => {
    const by = Object.fromEntries(snap.rows.map((r) => [r.name, r]));
    expect(by["Maria S."]).toMatchObject({ matchedBy: "customer id", eloyalty: 700, cl: 650, diff: 50, kkBank: 500, suggested: 700, hidden: false, template: "89fd70bc" });
    expect(by["Maria S."].reason).toMatch(/made by hand in the portal/);
    expect(by["Ben O."]).toMatchObject({ matchedBy: "serial", eloyalty: 650, cl: 650, diff: 0, reason: "both agree" });
    expect(by["Ina L."]).toMatchObject({ matchedBy: "customer id", diff: 0, template: "bc3fe237" });
    expect(by["Rafa D."]).toMatchObject({ matchedBy: null, cl: null, diff: null });
    expect(by["Rafa D."].reason).toMatch(/no balance/);
    expect(by["Deb C."]).toMatchObject({ hidden: true });
    expect(by["John D."]).toMatchObject({ matchedBy: null });
    // Guest (a serial eLoyalty doesn't know) and Peter are CL records with no pass.
    expect(snap.clOnly.map((u) => u.name)).toEqual(["Guest", "Peter W."]);
    expect(snap.counts).toEqual({ passes: 5, matched: 3, differ: 1, gapTotal: 50, passesNoCl: 2, clNoPass: 2, hiddenTests: 1, placeholders: 1, historyFor: 1 });
    expect(countsLine(snap.counts)).toBe("5 passes; 3 match a CL record; 1 differ (total gap 50); 2 passes with no CL record; 2 CL records with no pass; 1 team tests counted apart");
    // Biggest difference first.
    expect(snap.rows[0].name).toBe("Maria S.");
  });

  it("the snapshot carries First L. and numbers only: no id, serial, email or long digit run, and refuses one that would", () => {
    const text = JSON.stringify(snap);
    for (const bad of ["@", "wp-", "11111111-aaaa", "Santos", "Okafor", "f159927", "Real Person"]) expect(text).not.toContain(bad);
    expect(snapshotIsClean(snap)).toBe(true);
    expect(snapshotIsClean({ ...snap, rows: [{ ...snap.rows[0], name: "wp-1757900000001-aaa" }] })).toBe(false);
    expect(snapshotIsClean({ ...snap, clOnly: [{ name: "x@y", cl: null, kkBank: null, hasCustomerId: false, hasSerial: true }] })).toBe(false);
  });

  it("the id report: customer ids and numbers, most different first, then CL records with no pass; never a name, email or serial", () => {
    const report = idReportCsv(holders, records, hidden, history);
    const lines = report.trim().split("\n");
    expect(lines[0]).toBe(ID_REPORT_COLUMNS.join(","));
    // Six pass holders, then the two CL pass-linked records with no eLoyalty match (the guest and Peter).
    expect(lines).toHaveLength(1 + 6 + 2);
    expect(lines[1].startsWith("11111111-aaaa-4bbb-8ccc-000000000001,11111111-aaaa-4bbb-8ccc-000000000001,customer id,no,900,700,650,500,50,2026-10-05T09:00:00.000Z,50,team (portal),700,")).toBe(true);
    expect(report).toContain("11111111-aaaa-4bbb-8ccc-000000000005,,no CL record,yes,");
    expect(lines.slice(-2).every((l) => l.startsWith(",") && l.includes("no eLoyalty match"))).toBe(true);
    // A reason with a comma or semicolon is quoted, so every line has the same number of cells.
    const cells = (l: string) => {
      let n = 1;
      let quoted = false;
      for (const ch of l) {
        if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) n++;
      }
      return n;
    };
    expect(lines.map(cells)).toEqual(lines.map(() => ID_REPORT_COLUMNS.length));
    for (const bad of ["@", "wp-", "Maria", "Santos", "Okafor", "Ben O", "Guest", "Peter", "f159927"]) expect(report).not.toContain(bad);
  });

  it("the suggestion is always eLoyalty's balance, with the reason that fits", () => {
    const h = holders[0];
    expect(suggestion(h, null, null)).toMatchObject({ suggested: 700, reason: expect.stringMatching(/no balance/) });
    expect(suggestion(h, { ...records[0], clBalance: 700 }, null).reason).toBe("both agree");
    expect(suggestion(h, records[0], { at: "x", amount: 1, by: "API", kind: "earn" }).reason).toMatch(/came from the API/);
    expect(suggestion(h, records[0], null).reason).toMatch(/out of date/);
  });
});
