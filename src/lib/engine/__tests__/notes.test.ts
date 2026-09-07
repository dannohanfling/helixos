import { describe, expect, it } from "vitest";
import { MAX_TASKS_PER_NOTE, originLabel, parseTaskLines, TASK_SOURCES } from "../notes";
import { matchClaimForAppointment } from "../rewards";

describe("call notes → tasks", () => {
  it("takes one task per line, drops bullets and numbering, ignores blanks and repeats, caps the count", () => {
    expect(parseTaskLines("- Write the webinar title\n2) Invite 10 people\n\n• write the webinar title\n   ")).toEqual(["Write the webinar title", "Invite 10 people"]);
    expect(parseTaskLines(Array.from({ length: 15 }, (_, i) => `Task ${i}`).join("\n"))).toHaveLength(MAX_TASKS_PER_NOTE);
    expect(parseTaskLines("")).toEqual([]);
  });
  it("tells the client where a task came from, dated, and says nothing for their own tasks", () => {
    const fmt = (d: string) => d;
    expect(originLabel(TASK_SOURCES.coachCall, "2026-09-07", fmt)).toBe("From your call on 2026-09-07");
    expect(originLabel(TASK_SOURCES.coachCall, null, fmt)).toBe("From your call");
    expect(originLabel(TASK_SOURCES.manual, "2026-09-07", fmt)).toBeNull();
  });
});

describe("appointment → claim", () => {
  const a = { id: "a", rewardName: "VIP Laser Coaching Call" };
  const b = { id: "b", rewardName: "Offer + Messaging Alignment Session" };
  it("is certain with a mapped calendar id, and with exactly one open claim", () => {
    expect(matchClaimForAppointment([a, b], "cal_vip", { "VIP Laser Coaching Call": "cal_vip" }).claim).toEqual(a);
    expect(matchClaimForAppointment([b], "", {}).claim).toEqual(b);
    expect(matchClaimForAppointment([b], "cal_unknown", {}).claim).toEqual(b);
  });
  it("never guesses between two open claims, and says what would make it certain", () => {
    const m = matchClaimForAppointment([a, b], "", {});
    expect(m.claim).toBeNull();
    expect(m.note).toMatch(/2 open claims.*"calendarIds"/);
    expect(matchClaimForAppointment([], "cal_vip", { "VIP Laser Coaching Call": "cal_vip" }).claim).toBeNull();
    // a mapped calendar the member has no open claim for is not booked against something else
    expect(matchClaimForAppointment([b], "cal_vip", { "VIP Laser Coaching Call": "cal_vip" }).claim).toBeNull();
  });
});
