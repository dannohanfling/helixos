/**
 * Body: the pure rules behind nutrition targets (handoff rev 179, "BRIEF, 'Body'"; marks confirmed at revs 184 and 191). No
 * database, no I/O: the day's macros, the member's bands for the day type, and the status mark per macro. Everything here is per
 * member, and every member starts blank (rev 192): a band exists only once the member enters it, one macro at a time.
 */
import { daysBetween, weekday } from "@/lib/dates";

export const MACROS = ["cal", "p", "f", "c"] as const;
export type Macro = (typeof MACROS)[number];
export type Macros = Record<Macro, number>;
export type Band = { min: number; max: number };
/** A day type's bands. A macro with no band yet (a blank start, or a member who tracks only calories and protein) is absent. */
export type Bands = Partial<Record<Macro, Band>>;
export type Marks = Partial<Record<Macro, Mark>>;

export const hasBands = (b: Bands | null | undefined): b is Bands => !!b && MACROS.some((m) => b[m]);

export const MACRO_LABEL: Record<Macro, string> = { cal: "cal", p: "P", f: "F", c: "C" };
export const MACRO_NAME: Record<Macro, string> = { cal: "Calories", p: "Protein", f: "Fat", c: "Carbs" };

/**
 * ✅ in the band · 🟢 over the top on a macro where over is harmless (protein) · 🟡 slightly off · ⚠️ significantly off ·
 * ❌ out of band, or under a floor by more than slightly. "open" is a day still in progress that hasn't reached the bottom of a
 * band yet: not a judgement, just what's left to eat.
 */
export type Mark = "in" | "over_ok" | "slight" | "significant" | "out" | "open";
export const MARK_ICON: Record<Mark, string> = { in: "✅", over_ok: "🟢", slight: "🟡", significant: "⚠️", out: "❌", open: "⏳" };
export const MARK_WORD: Record<Mark, string> = { in: "in band", over_ok: "over, fine", slight: "slightly off", significant: "significantly off", out: "out of band", open: "to go" };

/**
 * How far off is "slightly" and "significantly": the larger of a percent of the band edge and an absolute amount. The absolute
 * amounts keep a narrow band honest (on a 0–5 g carb band, 6 g is slightly off, not significant) and match Danno's own rules:
 * under the calorie floor by less than 50, or over the fat top by less than 5 g, is 🟡.
 */
export const SLIGHT_PCT = 0.05;
export const SIGNIFICANT_PCT = 0.15;
export const ABS_TOLERANCE: Macros = { cal: 50, p: 5, f: 5, c: 3 };

export type MarkOpts = {
  /** A floor under the band (the calorie floor, the fat floor): below it by more than slightly is ❌, never ⚠️. */
  floor?: number | null;
  /** Over the top of this macro's band is harmless (🟢), e.g. protein. */
  overOk?: boolean;
  /** The day is over: below the band is judged. A day in progress below its band is "open". */
  final: boolean;
};

export function markFor(macro: Macro, value: number, band: Band, opts: MarkOpts): Mark {
  const floor = opts.floor ?? null;
  const min = floor !== null ? Math.max(band.min, floor) : band.min;
  let dev: number;
  let ref: number;
  let belowFloor = false;
  if (value > band.max) {
    if (opts.overOk) return "over_ok";
    dev = value - band.max;
    ref = band.max;
  } else if (value < min) {
    if (!opts.final) return "open";
    dev = min - value;
    ref = min;
    belowFloor = floor !== null && value < floor;
  } else return "in";
  const abs = ABS_TOLERANCE[macro];
  // Under a floor the line is hard: only the absolute amount counts as slight (under the calorie floor by less than 50 is 🟡).
  if (belowFloor) return dev <= abs ? "slight" : "out";
  if (dev <= Math.max(SLIGHT_PCT * ref, abs)) return "slight";
  if (dev <= Math.max(SIGNIFICANT_PCT * ref, 3 * abs)) return "significant";
  return "out";
}

export type Floors = { cal: number | null; f: number | null };

/** A mark for each macro that has a band; a macro without one gets none. */
export function dayMarks(totals: Macros, bands: Bands, opts: { floors: Floors; overOk: Macro[]; final: boolean }): Marks {
  const out: Marks = {};
  for (const m of MACROS) {
    const band = bands[m];
    if (!band) continue;
    const floor = m === "cal" ? opts.floors.cal : m === "f" ? opts.floors.f : null;
    out[m] = markFor(m, totals[m], band, { floor, overOk: opts.overOk.includes(m), final: opts.final });
  }
  return out;
}

/** The worst mark of the day, for a one-glance summary. "open" ranks with ✅: it isn't wrong yet. */
const RANK: Record<Mark, number> = { in: 0, open: 0, over_ok: 1, slight: 2, significant: 3, out: 4 };
export function worstMark(marks: Marks): Mark | null {
  const list = MACROS.flatMap((m) => (marks[m] ? [marks[m]!] : []));
  return list.length ? list.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) : null;
}

/* ───────── Macro math ───────── */

/** One logged line: a quantity of something whose macros are given per unit. */
export type Portion = { qty: number } & Macros;

export const ZERO: Macros = { cal: 0, p: 0, f: 0, c: 0 };

/** Rounded to one decimal so 0.1 + 0.2 never shows as 0.30000000000000004. */
const r1 = (n: number) => Math.round(n * 10) / 10;

export function portionMacros(p: Portion): Macros {
  return { cal: r1(p.cal * p.qty), p: r1(p.p * p.qty), f: r1(p.f * p.qty), c: r1(p.c * p.qty) };
}

export function sumMacros(list: Macros[]): Macros {
  const t = list.reduce((a, x) => ({ cal: a.cal + x.cal, p: a.p + x.p, f: a.f + x.f, c: a.c + x.c }), { ...ZERO });
  return { cal: r1(t.cal), p: r1(t.p), f: r1(t.f), c: r1(t.c) };
}

export function subMacros(a: Macros, b: Macros): Macros {
  return { cal: r1(a.cal - b.cal), p: r1(a.p - b.p), f: r1(a.f - b.f), c: r1(a.c - b.c) };
}

export function fmtMacro(m: Macro, n: number): string {
  const v = m === "cal" ? Math.round(n) : r1(n);
  return v.toLocaleString("en-US");
}

export function fmtBand(m: Macro, b: Band): string {
  return b.min === b.max ? fmtMacro(m, b.min) : `${fmtMacro(m, b.min)}–${fmtMacro(m, b.max)}`;
}

/**
 * Today's line (rev 179): "780 of 1,400–1,500 cal · 110 of 180–200 P", the first two macros with a band (calories and protein
 * when both are set), each with its mark once it's more than "to go".
 */
export function summaryLine(totals: Macros, bands: Bands, marks: Marks | null, max = 2): string {
  return MACROS.filter((m) => bands[m])
    .slice(0, max)
    .map((m) => {
      const mark = marks?.[m];
      return `${fmtMacro(m, totals[m])} of ${fmtBand(m, bands[m]!)} ${MACRO_LABEL[m]}${mark && mark !== "open" ? ` ${MARK_ICON[mark]}` : ""}`;
    })
    .join(" · ");
}

/* ───────── Which day type a date is ───────── */

/** 0 = Sunday … 6 = Saturday, to a day type id (or none). */
export type WeekPattern = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", string | null>>;
export type RefeedRule = { dayTypeId: string | null; anchor: string | null; everyDays: number };

/**
 * A date's day type: the member's override for that date first, then the refeed rule, then the weekly pattern. The refeed rule
 * starts at its anchor ("next refeed Saturday", a member setting) and repeats every N days from there; before the anchor, or with
 * no anchor set, no refeed days are generated (rev 186). A refeed replaces whatever the pattern says for that date.
 */
export function dayTypeIdFor(date: string, pattern: WeekPattern, refeed: RefeedRule, override?: string | null): string | null {
  if (override) return override;
  if (refeed.dayTypeId && refeed.anchor && date >= refeed.anchor && refeed.everyDays > 0 && daysBetween(refeed.anchor, date) % refeed.everyDays === 0) return refeed.dayTypeId;
  return pattern[String(weekday(date)) as keyof WeekPattern] ?? null;
}

/** The next refeed on or after a date, or null when the rule is off. */
export function nextRefeed(from: string, refeed: RefeedRule): string | null {
  if (!refeed.dayTypeId || !refeed.anchor || refeed.everyDays <= 0) return null;
  if (from <= refeed.anchor) return refeed.anchor;
  const past = daysBetween(refeed.anchor, from) % refeed.everyDays;
  if (past === 0) return from;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (refeed.everyDays - past));
  return d.toISOString().slice(0, 10);
}

/* ───────── What fits tonight ───────── */

export type MealOption = { id: string; name: string; totals: Macros };
export type Fit = { id: string; name: string; totals: Macros; after: Macros; inBand: number; marks: Marks };

/**
 * Saved meals that fit what's left of the day, rule-based (AI suggestions are "later" in the brief). A meal fits when adding it
 * takes no macro over the top of its band by more than slightly (🟡 is shown on the suggestion; a macro marked over-is-fine may
 * go over). The best fits land the most macros inside their bands; ties go to the one closest to the protein band, then fewest
 * calories.
 */
export function whatFits(eaten: Macros, bands: Bands, meals: MealOption[], opts: { floors: Floors; overOk: Macro[] }, limit = 5): Fit[] {
  // Only the macros the member has bands for count; with no bands at all there is nothing to fit.
  const banded = MACROS.filter((m) => bands[m]);
  if (!banded.length) return [];
  const fits: Fit[] = [];
  for (const meal of meals) {
    const after = sumMacros([eaten, meal.totals]);
    const marks = dayMarks(after, bands, { ...opts, final: false });
    if (banded.some((m) => after[m] > bands[m]!.max && (marks[m] === "significant" || marks[m] === "out"))) continue;
    const inBand = banded.filter((m) => marks[m] === "in" || marks[m] === "over_ok").length;
    fits.push({ id: meal.id, name: meal.name, totals: meal.totals, after, inBand, marks });
  }
  const proteinGap = (f: Fit) => (bands.p ? Math.max(0, bands.p.min - f.after.p) : 0);
  return fits.sort((a, b) => b.inBand - a.inBand || proteinGap(a) - proteinGap(b) || a.totals.cal - b.totals.cal).slice(0, limit);
}

/* ───────── Caps (e.g. cheese) ───────── */

/** A per-member cap on a tagged kind of food, in that food's unit: up to `soft` is fine, up to `hard` is the flex top, above is flagged. */
export type Cap = { tag: string; label: string; unit: string; soft: number; hard: number };
export type CapUse = Cap & { used: number; state: "ok" | "flex" | "over" };

export function capUse(caps: Cap[], lines: { capTag: string | null; qty: number }[]): CapUse[] {
  return caps.map((cap) => {
    const used = r1(lines.filter((l) => l.capTag === cap.tag).reduce((a, l) => a + l.qty, 0));
    return { ...cap, used, state: used > cap.hard ? "over" : used > cap.soft ? "flex" : "ok" };
  });
}

/* ───────── AI (rev 219) ───────── */

/**
 * May AI features use this member's Body data without a per-request button press? Only the member's own session, only while their
 * Body is on and they have switched on "Let AI use my Body data to support me". Never for anyone else's session: not a coach, not a
 * coach switched into the client's HelixOS.
 */
export function bodyAiAllowedFor(a: { viewerUserId: string; memberUserId: string; memberEnabled: boolean; aiUse: boolean }): boolean {
  return a.viewerUserId === a.memberUserId && a.memberEnabled && a.aiUse;
}

/**
 * Everything AI may be given about a member's Body: numbers and short text only. There is no place here for photos, private notes
 * or a coach's comments, so they can't be included by accident.
 */
export type BodyAiInput = {
  today: string;
  dayTypes: { name: string; bands: Bands }[];
  days: { date: string; dayType: string | null; totals: Macros; logged: number }[];
  todayEntries: { slot: string; name: string; items: { name: string; qty: number; unit: string }[]; totals: Macros }[];
  meals: string[];
  /** B2: the last week's sessions, each exercise with its sets in words, and days marked Off. */
  training?: { date: string; routine: string | null; lines: string[]; off: boolean }[];
  /** Body composition: the latest day's figure in words, and the 7-day average weight. */
  weighIn?: { date: string; text: string; avg7: string | null } | null;
};

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const macroText = (t: Macros) => MACROS.map((m) => `${fmtMacro(m, t[m])} ${MACRO_LABEL[m]}`).join(", ");

export function formatBodyForAi(x: BodyAiInput): string {
  const lines = [`Body data the member lets you use to support them (today is ${x.today}):`];
  if (x.dayTypes.length) lines.push(`Targets by day type: ${x.dayTypes.map((d) => `${short(d.name, 40)}: ${MACROS.filter((m) => d.bands[m]).map((m) => `${fmtBand(m, d.bands[m]!)} ${MACRO_LABEL[m]}`).join(", ") || "no targets yet"}`).join("; ")}.`);
  if (x.days.length) lines.push(`Last ${x.days.length} days: ${x.days.map((d) => `${d.date}${d.dayType ? ` (${short(d.dayType, 40)})` : ""}: ${d.logged ? macroText(d.totals) : "nothing logged"}`).join("; ")}.`);
  if (x.todayEntries.length) lines.push(`Eaten today: ${x.todayEntries.slice(0, 20).map((e) => `${short(e.slot, 20)}: ${short(e.name)} (${e.items.slice(0, 8).map((i) => `${i.qty} ${short(i.unit, 12)} ${short(i.name, 40)}`).join(", ")}) = ${macroText(e.totals)}`).join("; ")}.`);
  if (x.meals.length) lines.push(`Saved meals: ${x.meals.slice(0, 30).map((m) => short(m)).join(", ")}.`);
  if (x.weighIn) lines.push(`Latest weigh-in, ${x.weighIn.date}: ${short(x.weighIn.text, 200)}${x.weighIn.avg7 ? `; 7-day average weight ${x.weighIn.avg7}` : ""}.`);
  if (x.training?.length) lines.push(`Training, last ${x.training.length} entries: ${x.training.slice(0, 10).map((t) => (t.off ? `${t.date}: Off` : `${t.date}${t.routine ? ` ${short(t.routine, 40)}` : ""}: ${t.lines.slice(0, 12).map((l) => short(l, 80)).join("; ") || "started, no sets"}`)).join(" | ")}.`);
  return lines.join("\n");
}

/* ───────── Access (the privacy rule) ───────── */

/**
 * Who may read a member's Body data. Nobody while the member's Body is switched off (rev 195: Body ships dark, on per member by
 * script). Then the member always; a coach in the same workspace only while the member has "Let my coach see my Body data"
 * switched on, and then read-only plus day comments. Nobody else, ever: not another client, not a coach of another workspace,
 * not the export or the AI on the coach's behalf.
 */
export type BodyAccess = "self" | "coach" | null;
export function bodyAccessFor(a: { viewerUserId: string; viewerRole: "coach" | "client"; viewerWorkspaceId: string; memberUserId: string; memberWorkspaceId: string | null; memberRemoved: boolean; memberEnabled: boolean; shared: boolean }): BodyAccess {
  if (!a.memberEnabled) return null;
  if (a.viewerUserId === a.memberUserId && a.viewerWorkspaceId === a.memberWorkspaceId) return "self";
  if (a.viewerRole !== "coach") return null;
  if (!a.memberWorkspaceId || a.memberWorkspaceId !== a.viewerWorkspaceId || a.memberRemoved) return null;
  return a.shared ? "coach" : null;
}
