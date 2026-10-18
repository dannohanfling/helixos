import { describe, expect, it } from "vitest";
import { leakOf, type Counts } from "../aqueduct";
import { nextSeen, readSeen, repairFor, repairLine, seenChanged, type RepairSeen } from "../aqueduct-repair";

// Stages: posts, comments, DMs, conversations, calls booked, calls held, offers, clients. Step 1 is DMs → conversations.
const steady: Counts = [10, 100, 50, 25, 10, 8, 4, 2];
const dmLeak: Counts = [10, 100, 50, 9, 4, 3, 2, 1]; // DMs → conversations falls from 50% to 18%
const callLeak: Counts = [10, 100, 50, 25, 2, 1, 1, 1]; // conversations → booked falls from 40% to 8%
const today = "2026-10-18";

/** One open of the Aqueduct: what plays, and what is stored after. */
function open(seen: RepairSeen | null, now: Counts, before: Counts = steady, period = 30) {
  const leak = leakOf(now, before);
  const repair = repairFor(seen, leak, now, period);
  const next = nextSeen(seen, leak, period, today);
  return { leak, repair, next, write: seenChanged(seen, next) };
}

describe("the Aqueduct's repair moment (H-637 PR 2)", () => {
  it("never plays on a first visit, and stamps what was shown", () => {
    const first = open(null, dmLeak);
    expect(first.leak?.step).toBe(1);
    expect(first.repair).toBeNull();
    expect(first.write).toBe(true);
    expect(first.next).toEqual({ step: 1, rate: 0.18, period: 30, date: today });
  });

  it("a first visit with no leak stores 'no leak' and plays nothing", () => {
    const first = open(null, steady);
    expect(first.repair).toBeNull();
    expect(first.next.step).toBe(-1);
  });

  it("plays once when the leaking arch is repaired, with the card's words, then never again", () => {
    const seen = open(null, dmLeak).next;
    const healed = open(seen, steady);
    expect(healed.repair).toEqual({ step: 1, from: "DMs started", to: "Conversations", label: "to conversations", wasPct: 18, nowPct: 50, full: true });
    expect(repairLine(healed.repair!)).toBe("DMs started → Conversations is back to 50%, up from 18%. The fountain is full.");
    expect(healed.write).toBe(true);
    // The next open, with the marker moved on: nothing.
    const again = open(healed.next, steady);
    expect(again.repair).toBeNull();
    expect(again.write).toBe(false);
  });

  it("a new leak after a repair stamps silently, then plays its own repair when it heals", () => {
    let seen = open(open(null, dmLeak).next, steady).next; // repaired, no leak now
    const newLeak = open(seen, callLeak);
    expect(newLeak.leak?.step).toBe(2);
    expect(newLeak.repair).toBeNull();
    expect(newLeak.write).toBe(true);
    seen = newLeak.next;
    const healed = open(seen, steady);
    expect(healed.repair?.step).toBe(2);
    expect(healed.repair?.wasPct).toBe(8);
  });

  it("a leak that moves to another arch repairs the old one, and the fountain isn't full yet", () => {
    const seen = open(null, dmLeak).next;
    const moved = open(seen, callLeak);
    expect(moved.leak?.step).toBe(2);
    expect(moved.repair?.step).toBe(1);
    expect(moved.repair?.full).toBe(false);
    expect(repairLine(moved.repair!)).not.toContain("fountain");
    expect(moved.next.step).toBe(2);
  });

  it("keeps the rate from when the arch was first seen leaking while it still leaks", () => {
    const seen = open(null, dmLeak).next;
    const worse: Counts = [10, 100, 50, 5, 2, 2, 1, 1];
    const still = open(seen, worse);
    expect(still.repair).toBeNull();
    expect(still.write).toBe(false);
    expect(still.next.rate).toBe(0.18);
  });

  it("never plays across a 30 / 7 day switch, and re-stamps", () => {
    const seen = open(null, dmLeak, steady, 30).next;
    const switched = open(seen, steady, steady, 7);
    expect(switched.repair).toBeNull();
    expect(switched.write).toBe(true);
    expect(switched.next.period).toBe(7);
  });

  it("never plays when the old arch isn't actually higher than it was", () => {
    // DMs → conversations still at 18%, but calls fell further and took the leak.
    const seen = open(null, dmLeak).next;
    const bothBad: Counts = [10, 100, 50, 9, 0, 0, 0, 0]; // calls fall from 40% to 0%, further than DMs
    const r = open(seen, bothBad);
    expect(r.leak?.step).toBe(2);
    expect(r.repair).toBeNull();
    expect(r.write).toBe(true);
  });

  it("never plays when the old arch's rate can't be worked out now", () => {
    const seen = open(null, dmLeak).next;
    const noDms: Counts = [10, 100, 0, 0, 0, 0, 0, 0];
    expect(open(seen, noDms).repair).toBeNull();
  });

  it("reads a stored marker defensively", () => {
    expect(readSeen(null)).toBeNull();
    expect(readSeen("x")).toBeNull();
    expect(readSeen({ step: 9, period: 30 })).toBeNull();
    expect(readSeen({ step: 1.5, period: 30 })).toBeNull();
    expect(readSeen({ step: 1, period: 30, rate: "x" })).toEqual({ step: 1, rate: null, period: 30, date: "" });
    expect(readSeen({ step: -1, rate: null, period: 7, date: today })).toEqual({ step: -1, rate: null, period: 7, date: today });
  });
});
