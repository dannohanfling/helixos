import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hourInTz, todayInTz } from "@/lib/dates";
import { channelName, lastWeekOf, paceTally, platformName, rosterCopy, rosterLine, rosterName, scoreboardCopy, scoreboardDue, scoreboardSpoken, thisWeekOf, type Scoreboard } from "@/lib/engine/scoreboard";
import { brandedEmail } from "@/lib/branded-email";
import { allTools, toolsFor } from "@/lib/mcp/registry";
import "@/lib/mcp/tools";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const board = (over: Partial<Scoreboard> = {}): Scoreboard => ({
  week: { from: "2026-10-05", to: "2026-10-11" },
  days: 7,
  posts: { byChannel: [{ label: "Facebook Page", count: 3 }, { label: "Instagram", count: 1 }], total: 4, waiting: 1 },
  comments: 9,
  dms: { started: 12, conversations: 5 },
  calls: 2,
  closes: 5,
  clientsAdded: 1,
  lastIntention: { word: "Focus", keyResults: [{ text: "Book 3 calls", done: true }, { text: "Post 5 times", done: false }], tasks: [{ title: "Film the hook", done: true }], reviewed: true },
  thisIntention: null,
  keyResults: [{ title: "10 clients by Dec", pace: "ahead" }, { title: "$5k a month", pace: "behind" }, { title: "Newsletter", pace: "none" }],
  kpis: [{ name: "Calls booked", period: "month", actual: "4", target: "12", pace: "behind" }],
  ...over,
});

/** The Monday scoreboard (rev 635, answered rev 639): the week, the timing, the words, and what is never in it. */
describe("Monday scoreboard: when", () => {
  it("reports on the week that just ended, Monday to Sunday", () => {
    expect(lastWeekOf("2026-10-12")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(lastWeekOf("2026-10-11")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(lastWeekOf("2027-01-04")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(thisWeekOf("2026-10-14")).toEqual({ from: "2026-10-12", to: "2026-10-14" });
  });

  it("is due on Monday at the member's own morning hour, once a week, and never when turned off", () => {
    const at = { today: "2026-10-12", hour: 8, reminderHour: 8, sentWeek: null, on: true };
    expect(scoreboardDue(at)).toBe(true);
    expect(scoreboardDue({ ...at, hour: 9 })).toBe(false);
    expect(scoreboardDue({ ...at, today: "2026-10-13" })).toBe(false);
    expect(scoreboardDue({ ...at, sentWeek: "2026-10-12" })).toBe(false);
    expect(scoreboardDue({ ...at, sentWeek: "2026-10-05" })).toBe(true);
    expect(scoreboardDue({ ...at, on: false })).toBe(false);
    expect(scoreboardDue({ ...at, hour: 15, today: "2026-10-14" }, true)).toBe(true);
    expect(scoreboardDue({ ...at, today: "2026-10-14", sentWeek: "2026-10-12" }, true)).toBe(false);
    expect(scoreboardDue({ ...at, on: false }, true)).toBe(false);
  });

  it("finds 8am Monday in the member's zone across daylight saving and the date line", () => {
    const due = (iso: string, tz: string) => scoreboardDue({ today: todayInTz(tz, new Date(iso)), hour: hourInTz(tz, new Date(iso)), reminderHour: 8, sentWeek: null, on: true });
    // Los Angeles: summer time (UTC-7) the Monday before the clocks go back, standard time (UTC-8) the Monday after.
    expect(due("2026-10-26T15:00:00Z", "America/Los_Angeles")).toBe(true);
    expect(due("2026-11-02T15:00:00Z", "America/Los_Angeles")).toBe(false);
    expect(due("2026-11-02T16:00:00Z", "America/Los_Angeles")).toBe(true);
    // Auckland's Monday 8am is Sunday evening in UTC.
    expect(due("2026-10-11T19:00:00Z", "Pacific/Auckland")).toBe(true);
    expect(due("2026-10-12T19:00:00Z", "Pacific/Auckland")).toBe(false);
  });
});

describe("Monday scoreboard: the words", () => {
  it("the member's email: the numbers, where they come from, the 3-1-3, key results and KPIs", () => {
    const e = brandedEmail(scoreboardCopy("Maya", board()), { base: "https://app.test", settingsLink: false });
    expect(e.subject).toBe("Maya, your week: 4 posts, 12 DMs, 2 calls");
    for (const t of ["Posts shipped: 4 (3 Facebook Page, 1 Instagram)", "Waiting for GoHighLevel to confirm: 1", "Comments (you logged): 9", "DMs started: 12", "Calls booked: 2", "Clients added (you logged): 1", "Days closed: 5 of 7", "Book 3 calls: Done", "Post 5 times: Not done", "Film the hook: Done", "10 clients by Dec: ahead", "$5k a month: behind", "Calls booked (month): 4 of 12, behind", "Posts count once GoHighLevel confirms them"]) expect(e.text).toContain(t);
    expect(e.text).toContain("This week's isn't set yet.");
    // Not set this week: the one button sets it.
    expect(e.html).toContain('href="https://app.test/intentions#week"');
    expect(e.html).toContain("Set this week&#39;s 3-1-3");
    const set = brandedEmail(scoreboardCopy("Maya", board({ thisIntention: { word: "Ship", keyResults: ["Post 5 times"] } })), { base: "https://app.test", settingsLink: false });
    expect(set.html).toContain('href="https://app.test/today"');
    expect(set.text).toContain("This week's word: Ship");
  });

  it("every value is escaped, and a $ in a value is kept as written", () => {
    const e = brandedEmail(scoreboardCopy("Maya", board({ keyResults: [{ title: "<script>x</script> $& $1", pace: "on" }] })), { base: "https://app.test", settingsLink: false });
    expect(e.html).not.toContain("<script>x");
    expect(e.html).toContain("&lt;script&gt;x&lt;/script&gt; $&amp; $1");
    expect(e.html).not.toMatch(/<style|class=/);
  });

  it("the coach's roster: a first name and an initial, one line each, nothing that reaches a person", () => {
    expect(rosterName("Maya Torres")).toBe("Maya T");
    expect(rosterName("Cher")).toBe("Cher");
    expect(paceTally([{ pace: "ahead" }, { pace: "behind" }, { pace: "none" }])).toBe("1 ahead, 1 behind");
    expect(rosterLine("Maya Torres", board())).toBe("Maya T: 4 posts, 12 DMs, 2 calls, closes 5 of 7, 3-1-3 reviewed, key results: 1 ahead, 1 behind");
    expect(rosterLine("Jordan Lee", board({ lastIntention: null, keyResults: [] }))).toBe("Jordan L: 4 posts, 12 DMs, 2 calls, closes 5 of 7, no 3-1-3, no key results");
    const e = brandedEmail(rosterCopy("Danno", { from: "2026-10-05", to: "2026-10-11" }, [rosterLine("Maya Torres", board())]), { base: "https://app.test", settingsLink: false });
    expect(e.text).toContain("Maya T: 4 posts, 12 DMs");
    expect(e.html).toContain('href="https://app.test/coach"');
    expect(e.text).not.toMatch(/@|Torres/);
  });

  it("one name per place a post goes, sent or typed in", () => {
    expect(channelName("fb_group")).toBe(platformName("FB Group"));
    expect(channelName("instagram")).toBe(platformName("IG Reels"));
    expect(channelName("fb_page")).toBe("Facebook Page");
  });

  it("spoken: one sentence first", () => {
    expect(scoreboardSpoken(board(), "Last week").split("\n")[0]).toBe("Last week: 4 posts shipped, 12 DMs started, 2 calls booked, 5 of 7 days closed.");
  });
});

describe("Monday scoreboard: the rules", () => {
  it("never reads a Body or health table, anywhere it is built", () => {
    for (const f of ["src/lib/scoreboard.ts", "src/lib/engine/scoreboard.ts", "src/lib/mcp/tools/scoreboard.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/schema\.body[A-Z]|db\.query\.body[A-Z]/);
      expect(src, f).not.toMatch(/@\/lib\/(queries|actions)\/body|@\/lib\/body-|@\/lib\/engine\/body/);
    }
  });

  it("goes through the reminders' gate and the member's own switch; only a sent email stamps the week", () => {
    const src = read("src/lib/scoreboard.ts");
    expect(src).toMatch(/if \(!\(await canEmail\(m\.id\)\)\) continue;/);
    expect(src).toMatch(/on: m\.scoreboardEmail/);
    expect(src).toMatch(/if \(delivery === "sent"\) await db\.update\(schema\.memberships\)\.set\(\{ scoreboardSentWeek: mondayOf\(today\) \}\)/);
    expect(read("src/app/api/cron/reminders/route.ts")).toMatch(/await runScoreboards\(new Date\(\)\)/);
    expect(read("src/lib/actions/settings.ts")).toMatch(/scoreboardEmail: formData\.get\("scoreboardEmail"\) === "on"/);
  });

  it("scoreboard_read is a Today read, and a coach hears the roster", () => {
    expect(toolsFor(["today"]).map((t) => t.name)).toContain("scoreboard_read");
    expect(allTools().find((t) => t.name === "scoreboard_read")!.kind).toBe("read");
    expect(read("src/lib/mcp/tools/scoreboard.ts")).toMatch(/if \(v\.role === "coach" && !v\.switchedInto\)/);
  });
});
