/**
 * Danno's publishing rules for Recordings (rev 491), with no database in them: a call's series by its Fathom title, ignoring
 * case and punctuation; for a call no series names ("Impromptu Zoom Meeting"), the time slot it started in, within fifteen
 * minutes, in the rules' own timezone. A slot match gets a clear title in HelixOS ("Evolve Omega Accelerator · Mon 9 AM"),
 * since Fathom's API can't rename the call. The coach edits both lists on Recordings → Publishing rules; a workspace that never
 * has keeps these defaults. Replaces the rev 261 title phrases and the rev 265 backfill slots.
 */
import type { RecordingAudience } from "@/db/schema";

/** A rule publishes to a program, never to named members. */
export type ProgramAudience = Exclude<RecordingAudience, "members">;
export const PROGRAM_AUDIENCES: ProgramAudience[] = ["accelerator_academy", "academy"];
export type SeriesRule = { name: string; audience: ProgramAudience };
/** day: 0 is Sunday; time: "HH:MM", 24-hour. */
export type SlotRule = { name: string; day: number; time: string; audience: ProgramAudience };
export type RecordingRules = { timezone: string; series: SeriesRule[]; slots: SlotRule[] };

export const SLOT_WINDOW_MINUTES = 15;
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const ACC = "Evolve Omega Accelerator";
const ACA = "Evolve Omega Academy";
export const DEFAULT_RULES: RecordingRules = {
  timezone: "America/Los_Angeles",
  series: [
    { name: "Automation Accelerator", audience: "accelerator_academy" },
    { name: "Community Building", audience: "academy" },
    { name: "Business Strategy", audience: "academy" },
    { name: "Open Office Hours", audience: "academy" },
  ],
  slots: [
    { name: ACC, day: 1, time: "09:00", audience: "accelerator_academy" },
    { name: ACC, day: 3, time: "10:00", audience: "accelerator_academy" },
    { name: ACC, day: 4, time: "18:00", audience: "accelerator_academy" },
    { name: ACA, day: 1, time: "10:00", audience: "academy" },
    { name: ACA, day: 2, time: "10:00", audience: "academy" },
    { name: ACA, day: 4, time: "10:00", audience: "academy" },
    { name: ACA, day: 5, time: "13:00", audience: "academy" },
  ],
};

/** Lower case, punctuation gone, single spaces: "Evolve Omega: Automation Accelerator" reads "evolve omega automation accelerator". */
export const normTitle = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const minutesOfTime = (t: string): number | null => {
  const m = TIME.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export function validTimezone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** What is stored, read safely: anything malformed falls back to the defaults, a bad row is dropped. */
export function readRules(raw: unknown): RecordingRules {
  if (!raw || typeof raw !== "object") return DEFAULT_RULES;
  const r = raw as Partial<RecordingRules>;
  const aud = (a: unknown): a is ProgramAudience => PROGRAM_AUDIENCES.includes(a as ProgramAudience);
  const series = Array.isArray(r.series) ? r.series.filter((s): s is SeriesRule => Boolean(s && typeof s.name === "string" && normTitle(s.name) && aud(s.audience))) : DEFAULT_RULES.series;
  const slots = Array.isArray(r.slots) ? r.slots.filter((s): s is SlotRule => Boolean(s && typeof s.name === "string" && s.name.trim() && Number.isInteger(s.day) && s.day >= 0 && s.day <= 6 && typeof s.time === "string" && minutesOfTime(s.time) !== null && aud(s.audience))) : DEFAULT_RULES.slots;
  return { timezone: typeof r.timezone === "string" && validTimezone(r.timezone) ? r.timezone : DEFAULT_RULES.timezone, series, slots };
}

/** The series the title names, ignoring case and punctuation; the longest name wins when two fit. */
export function matchSeries(title: string, rules: RecordingRules): SeriesRule | null {
  const t = ` ${normTitle(title)} `;
  const hits = rules.series.filter((s) => normTitle(s.name) && t.includes(` ${normTitle(s.name)} `));
  return hits.sort((a, b) => normTitle(b.name).length - normTitle(a.name).length)[0] ?? null;
}

/** Day of week (0 Sunday) and minute of the day of an instant, in a timezone. */
export function wallOf(iso: string, tz: string): { day: number; minute: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  const day = DAY_SHORT.indexOf(get("weekday") as (typeof DAY_SHORT)[number]);
  if (day < 0) return null;
  return { day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

const WEEK = 7 * 24 * 60;
/** The slot the call started in, within fifteen minutes either side (the nearest, when two are close). */
export function matchSlot(startedAt: string | null, rules: RecordingRules): SlotRule | null {
  if (!startedAt) return null;
  const w = wallOf(startedAt, rules.timezone);
  if (!w) return null;
  const at = w.day * 1440 + w.minute;
  let best: { s: SlotRule; off: number } | null = null;
  for (const s of rules.slots) {
    const m = minutesOfTime(s.time);
    if (m === null) continue;
    const raw = Math.abs(at - (s.day * 1440 + m)) % WEEK;
    const off = Math.min(raw, WEEK - raw);
    if (off <= SLOT_WINDOW_MINUTES && (!best || off < best.off)) best = { s, off };
  }
  return best?.s ?? null;
}

/** "9 AM", "1 PM", "10:30 AM". */
export function timeLabel(time: string): string {
  const m = minutesOfTime(time) ?? 0;
  const h = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}
export const slotLabel = (s: SlotRule): string => `${DAY_SHORT[s.day]} ${timeLabel(s.time)}`;
/** HelixOS's own title for a call placed by its slot: "Evolve Omega Accelerator · Mon 9 AM". */
export const slotTitle = (s: SlotRule): string => `${s.name.trim()} · ${slotLabel(s)}`;

export type RuleMatch = { by: "series"; rule: SeriesRule; audience: ProgramAudience; clearTitle: null } | { by: "slot"; rule: SlotRule; audience: ProgramAudience; clearTitle: string };

/** The series first; the time slot only for a call whose title names no series. */
export function ruleMatch(title: string, startedAt: string | null, rules: RecordingRules): RuleMatch | null {
  const s = matchSeries(title, rules);
  if (s) return { by: "series", rule: s, audience: s.audience, clearTitle: null };
  const t = matchSlot(startedAt, rules);
  if (t) return { by: "slot", rule: t, audience: t.audience, clearTitle: slotTitle(t) };
  return null;
}

/** The rules as the form sends them: each row's fields, a blank name dropping the row. Refused rows name their field. */
export type RulesForm = { timezone: string; series: { name: string; audience: string; remove?: boolean }[]; slots: { name: string; day: string; time: string; audience: string; remove?: boolean }[] };
export function rulesFromForm(f: RulesForm): { ok: true; rules: RecordingRules } | { ok: false; error: string; field: string } {
  const timezone = f.timezone.trim();
  if (!validTimezone(timezone)) return { ok: false, error: `"${timezone}" isn't a timezone HelixOS knows. Use a name like America/Los_Angeles.`, field: "timezone" };
  const aud = (a: string): ProgramAudience | null => (PROGRAM_AUDIENCES.includes(a as ProgramAudience) ? (a as ProgramAudience) : null);
  const series: SeriesRule[] = [];
  const seen = new Set<string>();
  for (const [i, s] of f.series.entries()) {
    const name = s.name.trim().replace(/\s+/g, " ");
    if (s.remove || !name) continue;
    if (normTitle(name).length < 3) return { ok: false, error: `Series name "${name}" is too short to match a title. Use at least three letters.`, field: `series_name_${i}` };
    if (seen.has(normTitle(name))) return { ok: false, error: `"${name}" is listed twice.`, field: `series_name_${i}` };
    const a = aud(s.audience);
    if (!a) return { ok: false, error: `Choose who "${name}" is for.`, field: `series_audience_${i}` };
    seen.add(normTitle(name));
    series.push({ name, audience: a });
  }
  const slots: SlotRule[] = [];
  for (const [i, s] of f.slots.entries()) {
    const name = s.name.trim().replace(/\s+/g, " ");
    if (s.remove || !name) continue;
    const day = Number(s.day);
    if (!Number.isInteger(day) || day < 0 || day > 6 || s.day === "") return { ok: false, error: `Choose the day for "${name}".`, field: `slot_day_${i}` };
    if (minutesOfTime(s.time) === null) return { ok: false, error: `Give "${name}" a start time, like 09:00 or 18:00.`, field: `slot_time_${i}` };
    const a = aud(s.audience);
    if (!a) return { ok: false, error: `Choose who "${name}" is for.`, field: `slot_audience_${i}` };
    const [h, m] = s.time.trim().split(":");
    slots.push({ name, day, time: `${h.padStart(2, "0")}:${m}`, audience: a });
  }
  slots.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
  return { ok: true, rules: { timezone, series, slots } };
}
