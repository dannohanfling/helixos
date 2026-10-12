import { describe, expect, it } from "vitest";
import { hourInTz, todayInTz } from "@/lib/dates";
import { applyLatePlan, lateCountsLine, planLateCloses, readStamp, type LateLog, type LateMember } from "../late-close";
import { closeTarget, LATE_CLOSE_UNTIL_HOUR, runningStreak, SAME_CLOSE_HOURS, streakDayOf, type CloseMark } from "../streak";

// 2026-10-12 is a Monday. Los Angeles is UTC-7 in October.
const LA = "America/Los_Angeles";
const at = (local: string) => new Date(`${local}-07:00`);
const target = (marks: CloseMark[], local: string) => {
  const now = at(local);
  return closeTarget(marks, todayInTz(LA, now), hourInTz(LA, now), now);
};
const open: CloseMark[] = [];

describe("late close-outs: which day a close-out is for (rev 731)", () => {
  it("one constant for the window, one for the same close-out", () => {
    expect(LATE_CLOSE_UNTIL_HOUR).toBe(4);
    expect(SAME_CLOSE_HOURS).toBe(6);
  });

  it("23:50, 00:30 and 03:59 with Monday open count for Monday; 04:01 counts for Tuesday", () => {
    expect(target(open, "2026-10-12T23:50:00")).toEqual({ date: "2026-10-12", late: false, same: false });
    expect(target(open, "2026-10-13T00:30:00")).toEqual({ date: "2026-10-12", late: true, same: false });
    expect(target(open, "2026-10-13T03:59:00")).toEqual({ date: "2026-10-12", late: true, same: false });
    expect(target(open, "2026-10-13T04:01:00")).toEqual({ date: "2026-10-13", late: false, same: false });
  });

  it("00:30 with Monday already closed (over 6 hours ago) counts for Tuesday", () => {
    const marks = [{ date: "2026-10-12", eveningDoneAt: at("2026-10-12T17:00:00").toISOString(), morningDoneAt: null }];
    expect(target(marks, "2026-10-13T00:30:00")).toEqual({ date: "2026-10-13", late: false, same: false });
  });

  it("the same close-out: 23:00 then 01:00 with no lock-in between is one close-out for Monday, at any hour", () => {
    const marks = [{ date: "2026-10-12", eveningDoneAt: at("2026-10-12T23:00:00").toISOString(), morningDoneAt: null }];
    expect(target(marks, "2026-10-13T01:00:00")).toEqual({ date: "2026-10-12", late: false, same: true });
    // Still the same one at 04:30, past the window, while under 6 hours.
    expect(target(marks, "2026-10-13T04:30:00")).toEqual({ date: "2026-10-12", late: false, same: true });
    // Six hours on, a new close-out starts.
    expect(target(marks, "2026-10-13T05:01:00")).toEqual({ date: "2026-10-13", late: false, same: false });
  });

  it("a new lock-in starts a new close-out, even inside the 6 hours", () => {
    const marks = [
      { date: "2026-10-12", eveningDoneAt: at("2026-10-12T23:00:00").toISOString(), morningDoneAt: null },
      { date: "2026-10-13", eveningDoneAt: null, morningDoneAt: at("2026-10-13T00:45:00").toISOString() },
    ];
    expect(target(marks, "2026-10-13T01:00:00")).toEqual({ date: "2026-10-13", late: false, same: false });
  });

  it("a repaired day is never the last close-out", () => {
    const marks = [{ date: "2026-10-09", eveningDoneAt: at("2026-10-13T10:00:00").toISOString(), morningDoneAt: null, repairedAt: at("2026-10-13T10:00:00").toISOString() }];
    expect(target(marks, "2026-10-13T15:00:00")).toEqual({ date: "2026-10-13", late: false, same: false });
  });

  it("the streak survives a 01:00 close: alive before it, one longer after", () => {
    const closed = new Set(["2026-10-12", "2026-10-13"]);
    // Thursday 01:00, Wednesday still open: read as of Wednesday, the streak is alive.
    expect(streakDayOf(closed, "2026-10-15", 1)).toBe("2026-10-14");
    expect(runningStreak(closed, streakDayOf(closed, "2026-10-15", 1))).toBe(2);
    // Without the window, it would read as broken.
    expect(runningStreak(closed, "2026-10-15")).toBe(0);
    closed.add("2026-10-14");
    expect(runningStreak(closed, streakDayOf(closed, "2026-10-15", 1))).toBe(3);
    // After 04:00 the day is read as itself again.
    expect(streakDayOf(new Set(["2026-10-12"]), "2026-10-14", 4)).toBe("2026-10-14");
  });

  it("two members in different timezones at the same instant", () => {
    const now = new Date("2026-10-13T07:30:00Z");
    const la = closeTarget([], todayInTz(LA, now), hourInTz(LA, now), now);
    const london = closeTarget([], todayInTz("Europe/London", now), hourInTz("Europe/London", now), now);
    expect(la).toEqual({ date: "2026-10-12", late: true, same: false });
    expect(london).toEqual({ date: "2026-10-13", late: false, same: false });
  });
});

describe("late close-outs: the backfill dry run (rev 731)", () => {
  const log = (id: string, date: string, evening: string | null, extra: Partial<LateLog> = {}): LateLog => ({ id, date, eveningDoneAt: evening, morningDoneAt: null, repairedAt: null, streakDay: 0, ...extra });
  const member = (userId: string, logs: LateLog[], paid: string[] = [], streakPaid: string[] = paid): LateMember => ({
    userId,
    tz: LA,
    logs,
    paid: { close: new Set(paid), streak: new Set(streakPaid) },
    closePaidOn: new Map(paid.map((d) => [d, 20])),
  });
  // A: nightly 00:30 closes Tue, Wed, Thu, landed on the new day, Monday open. B: a 00:30 close on Wed, then a lock-in at 08:00
  // that morning. C: a 00:30 close with the day before closed. D: a time that can't be read. E: a repaired day at 01:00.
  const fixture = () => [
    member("a", [log("a2", "2026-10-13", "2026-10-13T07:30:00.000Z", { streakDay: 1 }), log("a3", "2026-10-14", "2026-10-14T07:30:00.000Z", { streakDay: 2 }), log("a4", "2026-10-15", "2026-10-15T07:30:00.000Z", { streakDay: 3 })], ["2026-10-13", "2026-10-14", "2026-10-15"]),
    member("b", [log("b1", "2026-10-12", "2026-10-13T03:00:00.000Z", { streakDay: 1 }), log("b3", "2026-10-14", "2026-10-14T07:30:00.000Z", { streakDay: 1, morningDoneAt: "2026-10-14T15:00:00.000Z" })], ["2026-10-12", "2026-10-14"]),
    member("c", [log("c1", "2026-10-12", "2026-10-13T03:00:00.000Z", { streakDay: 1 }), log("c2", "2026-10-13", "2026-10-13T07:30:00.000Z", { streakDay: 2 })], ["2026-10-12", "2026-10-13"]),
    member("d", [log("d1", "2026-10-13", "not a time")]),
    member("e", [log("e1", "2026-10-13", "2026-10-13T08:00:00.000Z", { repairedAt: "2026-10-13T08:00:00.000Z" })]),
  ];
  const now = new Date("2026-10-16T19:00:00Z"); // Friday noon in Los Angeles

  it("the dry run counts match the fixture", () => {
    const plan = planLateCloses(fixture(), now);
    expect(plan.counts).toEqual({ closesFound: 4, members: 2, daysCredited: 4, moved: 3, copied: 1, pointsToAward: 70, streaksUp: 0, streaksDown: 1, streakDaysChanged: 1, newDayAlreadyPaid: 3, newDayPointsKept: 60, unreadable: 1 });
    expect(plan.credits.map((x) => [x.userId, x.from, x.to, x.kind, x.closePoints + x.streakPoints])).toEqual([
      ["a", "2026-10-13", "2026-10-12", "move", 30],
      ["a", "2026-10-14", "2026-10-13", "move", 0],
      ["a", "2026-10-15", "2026-10-14", "move", 0],
      ["b", "2026-10-14", "2026-10-13", "copy", 40],
    ]);
    expect(plan.restamp).toEqual([{ userId: "b", date: "2026-10-14", streakDay: 3 }]);
    expect(lateCountsLine(plan.counts)).toMatch(/^Late close-outs dry run: 4 closes found, 2 members, 4 days credited \(3 moved, 1 copied/);
  });

  it("apply credits once, and a rerun changes nothing", () => {
    const members = fixture();
    const plan = planLateCloses(members, now);
    const after = members.map((m) => {
      const mine = plan.credits.filter((x) => x.userId === m.userId);
      const paidClose = new Set([...m.paid.close, ...mine.filter((x) => x.closePoints).map((x) => x.to)]);
      const paidStreak = new Set([...m.paid.streak, ...mine.filter((x) => x.streakPoints).map((x) => x.to)]);
      return { ...m, logs: applyLatePlan(m.logs, plan, m.userId), paid: { close: paidClose, streak: paidStreak } };
    });
    const a = after.find((m) => m.userId === "a")!;
    expect(a.logs.filter((l) => l.eveningDoneAt).map((l) => l.date).sort()).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    const b = after.find((m) => m.userId === "b")!;
    expect(b.logs.filter((l) => l.eveningDoneAt).map((l) => l.date).sort()).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    const again = planLateCloses(after, now);
    expect(again.credits).toEqual([]);
    expect(again.counts.pointsToAward).toBe(0);
  });

  it("reads stored times as UTC, and refuses what isn't a time", () => {
    expect(readStamp("2026-10-13 07:30:00")?.toISOString()).toBe("2026-10-13T07:30:00.000Z");
    expect(readStamp("2026-10-13T07:30:00.000Z")?.toISOString()).toBe("2026-10-13T07:30:00.000Z");
    expect(readStamp("2026-10-13")).toBeNull();
    expect(readStamp("not a time")).toBeNull();
    expect(readStamp(null)).toBeNull();
  });
});
