import { describe, expect, it } from "vitest";
import { lastMonths, pillarMonth, pillarSummary, type PillarLog } from "../pillars";

const log = (date: string, over: Partial<PillarLog> = {}): PillarLog => ({ date, eveningDoneAt: `${date}T17:00:00Z`, revContent: 0, revWebinar: 0, revDm: 0, posts: 0, webinarRegs: 0, webinarShows: 0, dmsStarted: 0, callsBooked: 0, ...over });

describe("revenue by pillar", () => {
  it("splits a month's revenue by source with shares and the activity behind each", () => {
    const logs = [log("2026-09-01", { revContent: 500, posts: 3 }), log("2026-09-02", { revDm: 1500, dmsStarted: 10, callsBooked: 2 }), log("2026-09-03", { revWebinar: 2000, webinarRegs: 40, webinarShows: 18 }), log("2026-08-30", { revDm: 999 })];
    const m = pillarMonth("2026-09", logs);
    expect(m.total).toBe(4000);
    expect(m.closedDays).toBe(3);
    expect(m.pillars.find((p) => p.key === "dm")).toMatchObject({ revenue: 1500, share: 38, activity: [{ label: "DMs started", value: 10 }, { label: "calls booked", value: 2 }] });
    expect(m.pillars.find((p) => p.key === "webinar")?.share).toBe(50);
    expect(m.pillars.find((p) => p.key === "content")?.activity[0].value).toBe(3);
  });

  it("lists the trailing months oldest first, across a year boundary", () => {
    expect(lastMonths("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("is honest about thin data instead of drawing a confident chart", () => {
    expect(pillarSummary([], "2026-09").honesty).toMatch(/No closed days yet/);
    expect(pillarSummary([log("2026-09-01", { revDm: 100 }), log("2026-09-02")], "2026-09").honesty).toMatch(/Only 2 closed days/);
    const six = Array.from({ length: 6 }, (_, i) => log(`2026-09-0${i + 1}`));
    expect(pillarSummary(six, "2026-09").honesty).toMatch(/no revenue logged yet/);
    const s = pillarSummary([...six, log("2026-09-07", { revWebinar: 900 }), log("2026-08-15", { revDm: 50 })], "2026-09");
    expect(s.leader?.key).toBe("webinar");
    expect(s.withData).toHaveLength(2);
    expect(s.honesty).toBe("7 closed days this month.");
  });
});
