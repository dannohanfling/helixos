import { describe, expect, it } from "vitest";
import { brokenStreak, runningStreak } from "../streak";
import { closeActivityPoints } from "../points";
import { comebackEmail } from "@/lib/reminders";

// 2026-09-07 is a Monday.
const closedRun = (from: string, to: string) => {
  const set = new Set<string>();
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) set.add(d.toISOString().slice(0, 10));
  }
  return set;
};

describe("streak break", () => {
  it("is silent while the streak is alive and when nothing meaningful was lost", () => {
    const alive = closedRun("2026-08-24", "2026-09-04"); // Mon 24 Aug → Fri 4 Sep, today Mon 7 Sep: weekend bridges
    expect(runningStreak(alive, "2026-09-07")).toBe(10);
    expect(brokenStreak(alive, "2026-09-07")).toBeNull();
    expect(brokenStreak(new Set(["2026-09-02"]), "2026-09-07")).toBeNull(); // a one-day streak is not worth a notice
  });

  it("names what was lost and offers a repair for exactly one missed weekday within a week", () => {
    const closed = closedRun("2026-08-24", "2026-09-03"); // through Thu 3 Sep; Fri 4 Sep missed; today Mon 7 Sep
    const b = brokenStreak(closed, "2026-09-07")!;
    expect(b).toMatchObject({ lost: 9, endedOn: "2026-09-03", missed: ["2026-09-04"], repairable: true });
    const twoMissed = closedRun("2026-08-24", "2026-09-02"); // Thu 3 and Fri 4 missed
    expect(brokenStreak(twoMissed, "2026-09-07")!.repairable).toBe(false);
    const stale = closedRun("2026-08-03", "2026-08-13"); // missed Fri 14 Aug, today 7 Sep: too long ago to mend
    expect(brokenStreak(stale, "2026-09-07")!.repairable).toBe(false);
    // Mending Friday restores the run
    closed.add("2026-09-04");
    expect(runningStreak(closed, "2026-09-07")).toBe(10);
  });
});

describe("close activity points", () => {
  it("does not score again what the app already scored during the day, and never goes negative", () => {
    const numbers = { dmsStarted: 3, conversations: 2, callsBooked: 1, callsHeld: 0, posts: 1 };
    expect(closeActivityPoints(numbers).total).toBe(3 * 5 + 2 * 2 + 25 + 15);
    expect(closeActivityPoints(numbers, { posts: 1, dmsStarted: 3 }).total).toBe(2 * 2 + 25);
    expect(closeActivityPoints(numbers, { posts: 5, dmsStarted: 9 }).total).toBe(2 * 2 + 25);
  });
});

describe("comeback email", () => {
  it("one subject every day, no backlog in the preheader, the link on its own line in the text and as the button in the HTML", () => {
    const c = comebackEmail("Maya", { morning: 8, evening: 17 }, "https://x");
    expect(c.subject).toBe("Maya, pick it back up");
    expect(c.html).toContain("No catching up to do. Just today.");
    expect(c.text.split("\n")).toContain("https://x/today");
    expect(c.html).toContain('<a href="https://x/today"');
    expect(c.html.match(/https:\/\/x\/today/g)).toHaveLength(1);
  });
});
