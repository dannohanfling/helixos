import { describe, expect, it } from "vitest";
import { dailyUse, dosesOn, expiryFrom, fillBoxes, medLines, refill, refillOpens, runsOut, scriptExpired, takesFromBottle, todayLine, type MedLike } from "@/lib/engine/body-meds";

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const dates = { addDays, daysBetween: (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000), weekday: (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() };
const fmt = (d: string) => d;
const base: MedLike = { name: "Metformin", type: "prescription", timesPerDay: 2, days: [], perDose: 1, onHand: 60, boxedUntil: null, supplyDays: 30, repeatsLeft: 3, lastFilledOn: "2026-10-01", issuedOn: "2026-07-01", expiresOn: "2027-07-01", refillRule: "before_runout", refillDays: 12, refillShare: 75, remindDays: 5, remindOn: "runout" };
const today = "2026-10-03";

describe("supplements and meds (rev 424, 431): arithmetic on what the member enters, never advice", () => {
  it("daily use, doses on a day, and the run-out date from the bottle", () => {
    expect(dailyUse(base)).toBe(2);
    expect(dailyUse({ ...base, days: [1, 3, 5], timesPerDay: 1 })).toBe(0.43);
    expect([dosesOn({ timesPerDay: 2, days: [1] }, 1), dosesOn({ timesPerDay: 2, days: [1] }, 2)]).toEqual([2, 0]);
    expect(runsOut(base, today, dates)).toBe("2026-11-01"); // 60 at 2 a day: today and 29 more
    expect(runsOut({ ...base, onHand: null }, today, dates)).toBeNull();
  });
  it("Tom's words: the refill opens 12 days before you run out; or once 75% of a fill is used", () => {
    expect(refillOpens(base, today, dates)).toBe("2026-10-20");
    expect(medLines(base, today, dates, fmt).map((l) => l.text)).toContain("Refill opens 12 days before you run out: 2026-10-20");
    const share = { ...base, refillRule: "share_used" as const };
    expect(refillOpens(share, today, dates)).toBe("2026-10-24"); // 75% of 30 days after the 1 Oct fill
    expect(medLines(share, today, dates, fmt)[1].text).toBe("Refill opens once 75% is used: 2026-10-24");
  });
  it("Joy's scripts: an expiry 6 or 12 months from issue; past it, repeats left can't be used and a refill is refused", () => {
    expect(expiryFrom("2026-08-31", 6)).toBe("2027-02-28");
    expect(expiryFrom("2026-07-01", 12)).toBe("2027-07-01");
    const old = { ...base, expiresOn: "2026-09-30" };
    expect(scriptExpired(old, today)).toBe(true);
    expect(medLines(old, today, dates, fmt).find((l) => l.tone === "stop")?.text).toBe("Script expired 2026-09-30: 3 repeats left can't be used. Ask for a new script.");
    expect(refill(old, today, null)).toEqual({ ok: false, why: "Metformin's script expired 2026-09-30; a refill needs a new script." });
    expect(medLines({ ...base, expiresOn: "2026-10-06" }, today, dates, fmt).map((l) => l.text)).toContain("Script expires 2026-10-06: ask for a new one before then.");
  });
  it("a refill adds a fill's supply and counts a repeat down; none left says so", () => {
    expect(refill(base, today, null)).toEqual({ ok: true, onHand: 120, repeatsLeft: 2, lastFilledOn: today, added: 60 });
    expect(refill({ ...base, supplyDays: null }, today, 90)).toMatchObject({ ok: true, onHand: 150, added: 90 });
    const none = { ...base, repeatsLeft: 0 };
    expect(refill(none, today, null)).toEqual({ ok: false, why: "Metformin has no refills left: ask your prescriber." });
    expect(medLines(none, today, dates, fmt).map((l) => l.text)).toContain("No refills left: ask your prescriber.");
    // A supplement has no repeats to count.
    expect(refill({ ...base, type: "supplement", repeatsLeft: null }, today, 30)).toMatchObject({ ok: true, repeatsLeft: null });
  });
  it("Tom's pill boxes: 14 days leave the bottle, the boxes cover to a date, the run-out date stays honest", () => {
    const filled = fillBoxes(base, 14, today, dates);
    expect(filled).toEqual({ ok: true, onHand: 32, boxedUntil: "2026-10-16", moved: 28 });
    const after = { ...base, onHand: 32, boxedUntil: "2026-10-16" };
    expect(runsOut(after, today, dates)).toBe(runsOut(base, today, dates));
    expect([takesFromBottle(after, "2026-10-10"), takesFromBottle(after, "2026-10-17")]).toEqual([false, true]);
    expect(fillBoxes({ ...base, onHand: 10 }, 14, today, dates)).toEqual({ ok: false, why: "The bottle holds 10; 14 days takes 28." });
  });
  it("Today shows the one line that needs doing: running low by the member's lead time, or the refill open", () => {
    const low = { ...base, onHand: 6 };
    expect(todayLine(low, today, dates, fmt)?.text).toBe("Running low: about 3 days left.");
    expect(todayLine(base, today, dates, fmt)).toBeNull();
    const open = { ...base, onHand: 20, remindOn: "refill_open" as const };
    expect(todayLine(open, today, dates, fmt)?.text).toBe("Refill is open now.");
  });
});
