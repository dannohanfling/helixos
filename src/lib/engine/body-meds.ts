/**
 * Supplements, vitamins and prescriptions (Danno, rev 424; Joy and Tom, rev 431), pure. HumanOS records what the member enters and
 * does the arithmetic on it: when the bottle runs out, when a refill opens, when a script expires, what a refill or a filled pill box
 * changes. It never suggests a dose and never checks interactions. Dates are YYYY-MM-DD in the member's own day.
 */
export const MED_TYPES = ["supplement", "vitamin", "prescription"] as const;
export type MedType = (typeof MED_TYPES)[number];
export const MED_TYPE_LABEL: Record<MedType, string> = { supplement: "Supplement", vitamin: "Vitamin", prescription: "Prescription" };
export const WITH_FOOD = ["with", "without", "either"] as const;
export type WithFood = (typeof WITH_FOOD)[number];
export const WITH_FOOD_LABEL: Record<WithFood, string> = { with: "with food", without: "without food", either: "with or without food" };
/** How a refill window opens: N days before the supply runs out (Tom's pharmacy), or once a share of a fill is used. */
export const REFILL_RULES = ["before_runout", "share_used"] as const;
export type RefillRule = (typeof REFILL_RULES)[number];
/** What the reminder waits for: the supply running low, or the refill window opening. */
export const REMIND_ON = ["runout", "refill_open"] as const;
export type RemindOn = (typeof REMIND_ON)[number];

export type MedLike = {
  name: string;
  type: MedType;
  timesPerDay: number;
  /** Weekdays it's taken, 0 = Sunday; none = every day. */
  days: number[];
  perDose: number;
  onHand: number | null;
  /** The last day the filled pill boxes cover; the bottle no longer holds those doses. */
  boxedUntil: string | null;
  supplyDays: number | null;
  repeatsLeft: number | null;
  lastFilledOn: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  refillRule: RefillRule;
  refillDays: number;
  refillShare: number;
  remindDays: number;
  remindOn: RemindOn;
};
export type Dates = { addDays: (d: string, n: number) => string; daysBetween: (a: string, b: string) => number; weekday: (d: string) => number };

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Doses on a date: its times a day when the weekday is one of its days (every day when none are set), else none. */
export const dosesOn = (m: Pick<MedLike, "timesPerDay" | "days">, weekday: number): number => (!m.days.length || m.days.includes(weekday) ? Math.max(0, m.timesPerDay) : 0);
/** Units used on an average day (a weekdays-only schedule counts its share of the week). */
export const dailyUse = (m: Pick<MedLike, "timesPerDay" | "days" | "perDose">): number => r2(m.perDose * m.timesPerDay * (m.days.length ? m.days.length / 7 : 1));

/** The last day the supply covers: through the filled boxes, then the bottle at the daily use. Null without a count or a schedule. */
export function runsOut(m: MedLike, today: string, d: Dates): string | null {
  const use = dailyUse(m);
  if (m.onHand == null || use <= 0) return null;
  const start = m.boxedUntil && m.boxedUntil >= today ? m.boxedUntil : d.addDays(today, -1);
  return d.addDays(start, Math.floor(m.onHand / use));
}
/** The first day a refill may be asked for, or null when there is no rule's worth of data. */
export function refillOpens(m: MedLike, today: string, d: Dates): string | null {
  if (m.refillRule === "share_used") {
    if (!m.lastFilledOn || !m.supplyDays) return null;
    return d.addDays(m.lastFilledOn, Math.ceil((m.supplyDays * Math.min(100, Math.max(1, m.refillShare))) / 100));
  }
  const out = runsOut(m, today, d);
  return out ? d.addDays(out, -Math.max(0, m.refillDays)) : null;
}
/** A script past its expiry: a new one is needed even with repeats left (Joy). */
export const scriptExpired = (m: Pick<MedLike, "type" | "expiresOn">, today: string): boolean => m.type === "prescription" && !!m.expiresOn && today > m.expiresOn;
/** "6 or 12 months from issue": the expiry a script gets when the member picks a length. */
export function expiryFrom(issuedOn: string, months: number): string {
  const [y, mo, day] = issuedOn.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export type MedLine = { tone: "info" | "soon" | "now" | "stop"; text: string };
/**
 * The lines a med carries, plainest first: when it runs out, when a refill opens (in the words people use), and the warnings the
 * member asked for: the supply low or the window open, the script expiring, no repeats left. `fmt` makes a date readable.
 */
export function medLines(m: MedLike, today: string, d: Dates, fmt: (date: string) => string): MedLine[] {
  const out: MedLine[] = [];
  const end = runsOut(m, today, d);
  const opens = refillOpens(m, today, d);
  const expired = scriptExpired(m, today);
  if (end) out.push({ tone: end < today ? "now" : "info", text: end < today ? "The supply has run out" : `Runs out around ${fmt(end)}` });
  if (m.type === "prescription") {
    if (m.refillRule === "share_used") out.push({ tone: "info", text: `Refill opens once ${m.refillShare}% is used${opens ? `: ${fmt(opens)}` : ""}` });
    else out.push({ tone: "info", text: `Refill opens ${m.refillDays} day${m.refillDays === 1 ? "" : "s"} before you run out${opens ? `: ${fmt(opens)}` : ""}` });
    if (expired) out.push({ tone: "stop", text: `Script expired ${fmt(m.expiresOn!)}${m.repeatsLeft ? `: ${m.repeatsLeft} repeat${m.repeatsLeft === 1 ? "" : "s"} left can't be used` : ""}. Ask for a new script.` });
    else if (m.repeatsLeft === 0) out.push({ tone: "stop", text: "No refills left: ask your prescriber." });
    if (!expired && m.expiresOn && d.daysBetween(today, m.expiresOn) <= m.remindDays) out.push({ tone: "soon", text: `Script expires ${fmt(m.expiresOn)}: ask for a new one before then.` });
  }
  const due = m.remindOn === "refill_open" && m.type === "prescription" ? opens && today >= opens : end && d.daysBetween(today, end) <= m.remindDays;
  if (due && !expired && end && end >= today) out.push({ tone: "soon", text: m.remindOn === "refill_open" && m.type === "prescription" ? "Refill is open now." : `Running low: about ${Math.max(0, d.daysBetween(today, end) + 1)} day${d.daysBetween(today, end) === 0 ? "" : "s"} left.` });
  return out;
}
/** The one line Today shows for a med that needs doing something about, or null. */
export function todayLine(m: MedLike, today: string, d: Dates, fmt: (date: string) => string): MedLine | null {
  const lines = medLines(m, today, d, fmt).filter((l) => l.tone !== "info");
  return lines.find((l) => l.tone === "stop") ?? lines.find((l) => l.tone === "now") ?? lines[0] ?? null;
}

/** A refill (a fill's supply, or the count the member typed): what it changes, or why it can't. */
export function refill(m: MedLike, today: string, added: number | null): { ok: true; onHand: number; repeatsLeft: number | null; lastFilledOn: string; added: number } | { ok: false; why: string } {
  if (scriptExpired(m, today)) return { ok: false, why: `${m.name}'s script expired ${m.expiresOn}; a refill needs a new script.` };
  if (m.type === "prescription" && m.repeatsLeft != null && m.repeatsLeft <= 0) return { ok: false, why: `${m.name} has no refills left: ask your prescriber.` };
  const fill = added != null && added > 0 ? added : m.supplyDays ? r2(m.supplyDays * dailyUse(m)) : null;
  if (fill == null) return { ok: false, why: `How many did you get? ${m.name} has no days' supply per fill to count from.` };
  return { ok: true, onHand: r2((m.onHand ?? 0) + fill), repeatsLeft: m.type === "prescription" && m.repeatsLeft != null ? m.repeatsLeft - 1 : m.repeatsLeft, lastFilledOn: today, added: fill };
}
/** Filled pill boxes (Tom): that many days of doses leave the bottle for the boxes, which then cover through a later day. */
export function fillBoxes(m: MedLike, days: number, today: string, d: Dates): { ok: true; onHand: number; boxedUntil: string; moved: number } | { ok: false; why: string } {
  const n = Math.round(days);
  if (!(n >= 1 && n <= 120)) return { ok: false, why: "Fill boxes for 1 to 120 days." };
  const from = m.boxedUntil && m.boxedUntil >= today ? m.boxedUntil : d.addDays(today, -1);
  let moved = 0;
  for (let i = 1; i <= n; i++) moved += dosesOn(m, d.weekday(d.addDays(from, i))) * m.perDose;
  moved = r2(moved);
  if (m.onHand != null && moved > m.onHand) return { ok: false, why: `The bottle holds ${m.onHand}; ${n} days takes ${moved}.` };
  return { ok: true, onHand: r2((m.onHand ?? 0) - moved), boxedUntil: d.addDays(from, n), moved };
}
/** A dose taken from the bottle comes off the count; one from a filled box already did. */
export const takesFromBottle = (m: Pick<MedLike, "boxedUntil">, date: string): boolean => !(m.boxedUntil && date <= m.boxedUntil);
