/**
 * The Aqueduct's repair moment (H-327 §4, plan H-637 PR 2): when last time's leaking arch is no longer the leak, by the same
 * rule that picks the picture (leakOf), the repair plays once. Pure: the marker the member last saw comes in, with today's
 * leak and counts, and out comes the repair to play (or null) and the marker to store next. Nothing here creates data; the
 * marker is a seen-state, like the rank the member last saw celebrated.
 *
 * The rules:
 * - Never on a first visit: no marker means nothing to repair. That visit only stamps.
 * - Never across a period switch: 30 days against 7 is a different reading, so it re-stamps silently.
 * - Once per repair: the marker moves on as soon as the repair plays, so it never plays twice.
 * - A real repair (plan H-637, decision 2): the old step's rate is known now and higher than when it was leaking, so the card
 *   can always say "back to X%, up from Y%" truthfully.
 */
import { stepRate, STAGES, STEP_LABELS, type Counts, type Leak } from "@/lib/engine/aqueduct";

/** What the member last saw: the leaking step (-1 for none), its rate then, the period, and the day it was stored. */
export type RepairSeen = { step: number; rate: number | null; period: number; date: string };

export type Repair = {
  /** The step that was leaking and isn't now. */
  step: number;
  from: string;
  to: string;
  label: string;
  wasPct: number;
  nowPct: number;
  /** No leak left anywhere: the fountain is full. */
  full: boolean;
};

const pctOf = (r: number) => Math.round(r * 100);

/** The repair to play on this open, or null. */
export function repairFor(seen: RepairSeen | null, leak: Leak | null, now: Counts, period: number): Repair | null {
  if (!seen) return null;
  if (seen.period !== period) return null;
  if (seen.step < 0 || seen.step > 5) return null;
  if (leak && leak.step === seen.step) return null;
  if (seen.rate === null) return null;
  const rate = stepRate(now, seen.step);
  if (rate === null) return null;
  const nowPct = pctOf(rate);
  const wasPct = pctOf(seen.rate);
  if (nowPct <= wasPct) return null;
  return { step: seen.step, from: STAGES[seen.step + 1], to: STAGES[seen.step + 2], label: STEP_LABELS[seen.step], wasPct, nowPct, full: leak === null };
}

/**
 * The marker to store after this open. The same step still leaking keeps the rate from when it was first seen leaking, so
 * "up from Y%" is the low the member actually saw.
 */
export function nextSeen(seen: RepairSeen | null, leak: Leak | null, period: number, today: string): RepairSeen {
  const step = leak ? leak.step : -1;
  if (seen && seen.step === step && seen.period === period && step >= 0) return seen;
  return { step, rate: leak ? leak.nowRate : null, period, date: today };
}

/** Whether the stored marker needs writing: a first visit, a new leak, a healed one, or a period switch. */
export function seenChanged(seen: RepairSeen | null, next: RepairSeen): boolean {
  return !seen || seen.step !== next.step || seen.period !== next.period;
}

/** The card's line under "Your water is flowing again." */
export function repairLine(r: Repair): string {
  return `${r.from} → ${r.to} is back to ${r.nowPct}%, up from ${r.wasPct}%.${r.full ? " The fountain is full." : ""}`;
}

/** Reads a stored marker defensively: anything malformed counts as never visited. */
export function readSeen(v: unknown): RepairSeen | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.step !== "number" || !Number.isInteger(o.step) || o.step < -1 || o.step > 5) return null;
  if (typeof o.period !== "number") return null;
  const rate = typeof o.rate === "number" && Number.isFinite(o.rate) ? o.rate : null;
  return { step: o.step, rate, period: o.period, date: typeof o.date === "string" ? o.date : "" };
}
