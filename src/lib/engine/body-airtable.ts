/**
 * Body's Airtable history (B5, rev 237 phase 7): a member's HumanOS base mapped into HelixOS, pure and testable. Three tables
 * are read: the Journal (one row a day, sometimes more), the Exercises rows linked to Journal days (structured sets, spring
 * 2026), and the Routines. Nothing of the base's other tables is ever read.
 *
 * Weigh-ins come from three field generations that replaced each other; where a day has more than one, the newest wins. The
 * oldest stores percents as fractions, the others as whole numbers; all land on one scale. Days marked estimated or carried
 * forward are left out and counted. Sets come from the Exercises rows where a day has them, else from the day's Exercise Notes,
 * read line by line: an exercise heading, then "• 65 × 10" (or "12.5×15×3" for three alike) under it; warm-ups, meals and
 * recovery are passed over. The notes' words never come across: only the sets. Macro columns are targets, not intake, and stay
 * in Airtable; so does everything the coach never sees (notes, photos, injuries).
 */
import { field, num, option, text, type AirtableRecord } from "@/lib/engine/airtable-import";
import { inRange, type MetricKey } from "@/lib/engine/body-scale";

export type HumanosSource = { journal: AirtableRecord[]; exercises: AirtableRecord[]; routines: AirtableRecord[] };

/* ── Weigh-ins ── */

export type Generation = "latest" | "middle" | "oldest";
type GenSpec = { gen: Generation; fields: Partial<Record<MetricKey, string>>; fraction: boolean };
/** Newest first. The keys are the fields' names without their emoji (fieldKey). */
const GENERATIONS: GenSpec[] = [
  { gen: "latest", fraction: false, fields: { weight: "renpho weight", bf: "renpho body fat %", smm_pct: "renpho skeletal muscle %", visceral: "renpho visceral fat", water: "renpho body water %", met_age: "renpho metabolic age", bmr: "renpho bmr" } },
  { gen: "middle", fraction: false, fields: { weight: "renpho current weight", bf: "renpho current body fat", smm_pct: "renpho current skeletal muscle", water: "renpho current body water", ffm: "renpho current fat-free mass", visceral: "renpho current visceral fat", bmr: "renpho current bmr", met_age: "renpho current metabolic age" } },
  { gen: "oldest", fraction: true, fields: { weight: "weight", bf: "body fat %", smm_pct: "skeletal muscle %", water: "body water %", ffm: "fat-free mass", visceral: "visceral fat", bmr: "bmr", met_age: "metabolic age" } },
];
const PERCENT: MetricKey[] = ["bf", "smm_pct", "water"];

export type WeighIn = { date: string; recordId: string; gen: Generation; values: Partial<Record<MetricKey, number>> };
export type SkippedWeighIn = { date: string; why: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** One row's reading from its newest generation with a weight, percents on one scale, anything out of range dropped. */
function readingOf(r: AirtableRecord): WeighIn | null {
  const date = text(r, "date");
  if (!DATE.test(date)) return null;
  for (const g of GENERATIONS) {
    const weight = num(r, g.fields.weight!);
    if (weight == null) continue;
    const values: Partial<Record<MetricKey, number>> = {};
    for (const [key, name] of Object.entries(g.fields) as [MetricKey, string][]) {
      let v = num(r, name);
      if (v == null) continue;
      if (g.fraction && PERCENT.includes(key) && v <= 1) v = v * 100;
      v = key === "visceral" || key === "bmr" || key === "met_age" ? Math.round(v) : round1(v);
      if (inRange(key, v)) values[key] = v;
    }
    if (values.weight == null) return null;
    return { date, recordId: r.id, gen: g.gen, values };
  }
  return null;
}

/** The Journal's weigh-ins, one a day: the newest generation wins, then the fuller reading. Estimated and carried-forward days are counted, not taken. */
export function weighInsFrom(journal: AirtableRecord[]): { weighIns: WeighIn[]; skipped: SkippedWeighIn[] } {
  const byDay = new Map<string, WeighIn>();
  const skipped: SkippedWeighIn[] = [];
  const rank = (g: Generation) => GENERATIONS.findIndex((x) => x.gen === g);
  for (const r of journal) {
    const kind = option(text(r, "renpho data type"));
    const x = readingOf(r);
    if (!x) continue;
    if (kind && kind !== "Exact") {
      skipped.push({ date: x.date, why: kind.toLowerCase() });
      continue;
    }
    const have = byDay.get(x.date);
    if (!have || rank(x.gen) < rank(have.gen) || (x.gen === have.gen && Object.keys(x.values).length > Object.keys(have.values).length)) byDay.set(x.date, x);
  }
  return { weighIns: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)), skipped: skipped.sort((a, b) => a.date.localeCompare(b.date)) };
}

/* ── Sets ── */

export type SetLine = { weight: number | null; reps: number };
export type ExerciseSets = { name: string; sets: SetLine[] };

const SKIP_SECTION = /^(warm[- ]?ups?\b|recovery\b|meal\b|context\b|cardio\b|guardrails?\b|notes?\b|nutrition\b|hydration\b|mobility\b)/i;
const MUSCLE = /^(triceps?|biceps?|chest|back|shoulders?|legs?|rear delts?|calves|abs|core|glutes|hamstrings?|quads?)$/i;
/** A movement word that needs its muscle to be a name: "Triceps — Extensions" is "Triceps Extensions"; "Triceps — Skullcrushers" is "Skullcrushers". */
const GENERIC = /^(extensions?|curls?|press|presses|raises?|fly|flies|rows?|pushdowns?|pulldowns?|dips|kickbacks?|pull-?ups?|push-?ups?)$/i;
const stripEmoji = (s: string) => s.replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ").trim();
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** "Primary — Squats (Back-Safe)" → "Squats"; "Romanian Deadlift (DB) — KEEP 2ND, because…" → "Romanian Deadlift"; "Triceps — Extensions" → "Triceps Extensions". */
export function exerciseName(line: string): string | null {
  let s = stripEmoji(line).replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  s = s.replace(/[:.]+$/, "").trim();
  const parts = s.split(/\s+[—–-]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (words(first) <= 3 && words(last) <= 5) s = MUSCLE.test(first) && GENERIC.test(last) ? `${first} ${last}` : last;
    else s = first;
  }
  s = s.replace(/[:.]+$/, "").trim();
  if (!s || s.length > 60 || /^\d/.test(s)) return null;
  // Whole-caps names read better in title case; mixed case is kept as written.
  if (s === s.toUpperCase() && /[A-Z]{3}/.test(s)) s = s.toLowerCase().replace(/(^|\s|-)\S/g, (c) => c.toUpperCase());
  return s;
}

/** "65 × 10", "65x10", "12.5×15×3" (three alike), "BW × 15" (bodyweight); anything after a parenthesis is ignored. */
export function readSetLine(line: string): SetLine[] | null {
  const s = line.replace(/^[•\-*·]\s*/, "").replace(/\([^)]*\)/g, "").trim();
  const m = s.match(/^(bw|body\s*weight|[\d.]+)\s*(?:lbs?|kg)?\s*[×x✕*]\s*(\d+)(?:\s*(?:reps?)?\s*[×x✕*]\s*(\d+)(?:\s*sets?)?)?\s*(?:reps?)?$/i);
  if (!m) return null;
  const weight = /^b/i.test(m[1]) ? null : Number(m[1]);
  const reps = Number(m[2]);
  const times = m[3] ? Number(m[3]) : 1;
  if ((weight != null && !(weight >= 0 && weight < 5000)) || !(reps >= 1 && reps <= 500) || !(times >= 1 && times <= 20)) return null;
  return Array.from({ length: times }, () => ({ weight, reps }));
}

/**
 * The sets in a day's Exercise Notes, exercise by exercise, and how many lines under an exercise couldn't be read. A warm-up,
 * meal or recovery section at the top level lasts until "Working Session" (or a shouted title); a warm-up inside an exercise
 * lasts until its "Working Sets" or the next exercise.
 */
export function parseNotes(notes: string): { exercises: ExerciseSets[]; unread: number } {
  const out: ExerciseSets[] = [];
  let current: ExerciseSets | null = null;
  let skipping: "none" | "soft" | "hard" = "none";
  let unread = 0;
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[•\-*·]\s*/.test(line)) {
      if (skipping !== "none" || !current) continue;
      const sets = readSetLine(line);
      if (sets) current.sets.push(...sets);
      else unread++;
      continue;
    }
    const plain = stripEmoji(line);
    if (/^warm[- ]?ups?\s*:/i.test(plain)) continue; // "warmup: 45×10" inside an exercise: the line goes, the exercise stays
    if (/^working\s+sets?\b/i.test(plain)) {
      if (skipping === "soft") skipping = "none";
      continue;
    }
    if (/^working\s+session\b/i.test(plain)) {
      skipping = "none";
      current = null;
      continue;
    }
    const bare = plain.replace(/\([^)]*\)/g, "").trim();
    if (SKIP_SECTION.test(bare)) {
      skipping = current && skipping === "none" ? "soft" : "hard";
      continue;
    }
    // A shouted title ("MONDAY CHEST + TRI — getting back on track") is a section, not an exercise.
    if (bare === bare.toUpperCase() && /[A-Z]{3}/.test(bare) && words(bare.split(/\s+[—–-]\s+/)[0]) >= 2) {
      skipping = "none";
      current = null;
      continue;
    }
    if (skipping === "hard") continue;
    const name = exerciseName(line);
    if (!name) {
      current = null;
      continue;
    }
    skipping = "none";
    current = out.find((e) => e.name.toLowerCase() === name.toLowerCase()) ?? null;
    if (!current) {
      current = { name, sets: [] };
      out.push(current);
    }
  }
  return { exercises: out.filter((e) => e.sets.length), unread };
}

export type SessionPlan = { date: string; routineName: string | null; from: "table" | "notes"; exercises: ExerciseSets[]; unread: number };

const linked = (r: AirtableRecord, ...keys: string[]): string[] => {
  const v = field(r, ...keys);
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : typeof x === "object" && x && "id" in x ? String((x as { id: unknown }).id) : "")).filter(Boolean) : [];
};

/** "Working sets: 145 × 15, 145 × 15" in an Exercises row's Notes, when the row has no triple; a warm-up line stays out (Danno, 1 Oct). */
export function setsFromRowNotes(notes: string): SetLine[] {
  const out: SetLine[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /warm/i.test(line)) continue;
    const m = line.match(/^(?:working\s+sets?\s*:)?\s*(.+)$/i);
    if (!m || !/^working/i.test(line)) continue;
    for (const part of m[1].split(/\s*[,/;]\s*/)) {
      const sets = readSetLine(part);
      if (sets) out.push(...sets);
    }
  }
  return out;
}

const sameSets = (a: SetLine[], b: SetLine[]) => a.length === b.length && a.every((x, i) => x.weight === b[i].weight && x.reps === b[i].reps);

/**
 * Every day with sets. Danno's rules (1 Oct): an Exercises row linked to more than two Journal days is a library row and gives no
 * sets; one linked to two lands on the later day only; a Journal row typed Off Day is a draft and gives none; a day entered twice
 * with the same lines takes them once. Where a day has rows, those win; else its notes, when asked.
 */
export function sessionsFrom(src: HumanosSource, opts: { notes: boolean }): SessionPlan[] {
  const dateOf = new Map<string, string>();
  const offDay = new Set<string>();
  const routineOf = new Map<string, string | null>();
  const notesOf = new Map<string, string[]>();
  const routineName = new Map(src.routines.map((r) => [r.id, exerciseName(text(r, "name")) ?? option(text(r, "name"))]));
  for (const r of src.journal) {
    const date = text(r, "date");
    if (!DATE.test(date)) continue;
    dateOf.set(r.id, date);
    if (/off day/i.test(text(r, "exercise type"))) {
      offDay.add(r.id);
      continue;
    }
    const rn = linked(r, "routines").map((id) => routineName.get(id)).find(Boolean) ?? null;
    if (rn && !routineOf.get(date)) routineOf.set(date, rn);
    const n = text(r, "exercise notes");
    if (n) notesOf.set(date, [...(notesOf.get(date) ?? []), n]);
  }
  const table = new Map<string, ExerciseSets[]>();
  for (const e of src.exercises) {
    const name = exerciseName(text(e, "exercise"));
    if (!name) continue;
    const days = linked(e, "journal").filter((jid) => dateOf.has(jid) && !offDay.has(jid));
    if (!days.length || linked(e, "journal").length > 2) continue;
    const date = days.map((jid) => dateOf.get(jid)!).sort().pop()!;
    const weight = num(e, "rep weight");
    const reps = num(e, "reps / set");
    const n = num(e, "sets");
    const sets: SetLine[] = reps != null && n != null && reps >= 1 && n >= 1 ? Array.from({ length: Math.min(n, 20) }, () => ({ weight: weight != null && weight > 0 ? weight : null, reps: Math.min(reps, 500) })) : setsFromRowNotes(text(e, "notes"));
    if (!sets.length) continue;
    const day = table.get(date) ?? [];
    const ex = day.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (ex && sameSets(ex.sets, sets)) continue;
    if (ex) ex.sets.push(...sets);
    else day.push({ name, sets });
    table.set(date, day);
  }
  const out: SessionPlan[] = [];
  const dates = new Set([...table.keys(), ...(opts.notes ? notesOf.keys() : [])]);
  for (const date of [...dates].sort()) {
    const t = table.get(date);
    if (t?.length) {
      out.push({ date, routineName: routineOf.get(date) ?? null, from: "table", exercises: t, unread: 0 });
      continue;
    }
    if (!opts.notes) continue;
    const merged: ExerciseSets[] = [];
    let unread = 0;
    for (const n of notesOf.get(date) ?? []) {
      const p = parseNotes(n);
      unread += p.unread;
      for (const e of p.exercises) {
        const have = merged.find((x) => x.name.toLowerCase() === e.name.toLowerCase());
        if (have && sameSets(have.sets, e.sets)) continue;
        if (have) have.sets.push(...e.sets);
        else merged.push({ name: e.name, sets: [...e.sets] });
      }
    }
    if (merged.length) out.push({ date, routineName: routineOf.get(date) ?? null, from: "notes", exercises: merged, unread });
  }
  return out;
}

/* ── Routines ── */

export type RoutinePlan = { name: string; items: { exerciseName: string; sets: number; reps: string }[] };

export function routinesFrom(src: HumanosSource): RoutinePlan[] {
  const byId = new Map(src.exercises.map((e) => [e.id, e]));
  const out: RoutinePlan[] = [];
  for (const r of src.routines) {
    const name = exerciseName(text(r, "name")) ?? option(text(r, "name"));
    if (!name) continue;
    const items: RoutinePlan["items"] = [];
    for (const id of linked(r, "exercises")) {
      const e = byId.get(id);
      const en = e && exerciseName(text(e, "exercise"));
      if (!en || items.some((i) => i.exerciseName.toLowerCase() === en.toLowerCase())) continue;
      const sets = num(e, "sets");
      const reps = num(e, "reps / set");
      items.push({ exerciseName: en, sets: sets && sets >= 1 ? Math.min(Math.round(sets), 20) : 3, reps: reps && reps >= 1 ? String(Math.round(reps)) : "8–12" });
    }
    if (items.length) out.push({ name, items });
  }
  return out;
}

/* ── The plan ── */

export type Existing = { exercises: Map<string, string>; routines: Set<string>; sessionDates: Set<string>; readingIds: Set<string>; /** The member already has sessions or weigh-ins that didn't come from this importer (rev 296: Danno, through the connector), so the page opens in day-types-only mode. */ ownHistory?: boolean; /** The member's day types by name (lower-cased), so an imported day's routine can set its day type where one matches. */ dayTypes?: Map<string, string>; /** The member's routines by name, so an imported day links to its routine. */ routineIds?: Map<string, string> };
export type HistoryOptions = { notes: boolean; from: string | null; /** Rev 296: write nothing but each day's day type from the Journal's routine, for a member whose history is already in. */ dayTypesOnly?: boolean };
export type HistoryPlan = {
  weighIns: (WeighIn & { status: "new" | "have" })[];
  skippedWeighIns: SkippedWeighIn[];
  sessions: (SessionPlan & { status: "new" | "have"; dayTypeId: string | null })[];
  exercises: { name: string; status: "new" | "have" }[];
  routines: (RoutinePlan & { status: "new" | "have" })[];
  missing: string[];
  /** Day types only (rev 296): the sessions are read for their dates and routines, and nothing else is planned. */
  dayTypesOnly?: boolean;
};
export const readingIdFor = (recordId: string) => `airtable:${recordId}`;
const lc = (s: string) => s.trim().toLowerCase();

/** Everything the import would write, against what the member already holds, so the dry run says new or already in. */
export function buildHistoryPlan(src: HumanosSource, existing: Existing, opts: HistoryOptions): HistoryPlan {
  const from = opts.from && DATE.test(opts.from) ? opts.from : null;
  const w = weighInsFrom(src.journal);
  const weighIns = w.weighIns.filter((x) => !from || x.date >= from).map((x) => ({ ...x, status: existing.readingIds.has(readingIdFor(x.recordId)) ? ("have" as const) : ("new" as const) }));
  const sessions = sessionsFrom(src, { notes: opts.notes })
    .filter((s) => !from || s.date >= from)
    .map((s) => ({ ...s, status: existing.sessionDates.has(s.date) ? ("have" as const) : ("new" as const), dayTypeId: (s.routineName && existing.dayTypes?.get(lc(s.routineName))) || null }));
  const routines = routinesFrom(src).map((r) => ({ ...r, status: existing.routines.has(lc(r.name)) ? ("have" as const) : ("new" as const) }));
  const names = new Map<string, string>();
  for (const s of sessions) if (s.status === "new") for (const e of s.exercises) names.set(lc(e.name), e.name);
  for (const r of routines) if (r.status === "new") for (const i of r.items) names.set(lc(i.exerciseName), i.exerciseName);
  const exercises = [...names.values()].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, status: existing.exercises.has(lc(name)) ? ("have" as const) : ("new" as const) }));
  if (opts.dayTypesOnly) return { weighIns: [], skippedWeighIns: [], sessions, exercises: [], routines: [], missing: [], dayTypesOnly: true };
  return { weighIns, skippedWeighIns: w.skipped.filter((x) => !from || x.date >= from), sessions, exercises, routines, missing: [] };
}

export type HistorySummary = { weighIns: number; weighInsHave: number; sessions: number; sessionsHave: number; sets: number; exercises: number; routines: number; skipped: number; unread: number; /** Days whose day type the plan sets (every session with a routine that maps to one of the member's day types, already in or not). */ days: number };
export function historySummary(p: HistoryPlan): HistorySummary {
  const fresh = p.sessions.filter((s) => s.status === "new");
  return {
    weighIns: p.weighIns.filter((x) => x.status === "new").length,
    weighInsHave: p.weighIns.length - p.weighIns.filter((x) => x.status === "new").length,
    sessions: fresh.length,
    sessionsHave: p.sessions.length - fresh.length,
    sets: fresh.reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.length, 0), 0),
    exercises: p.exercises.filter((e) => e.status === "new").length,
    routines: p.routines.filter((r) => r.status === "new").length,
    skipped: p.skippedWeighIns.length,
    unread: fresh.reduce((n, s) => n + s.unread, 0),
    days: p.sessions.filter((s) => s.dayTypeId).length,
  };
}

/** The keys the reader asks for (table names without their emoji). */
export const HUMANOS_TABLES = ["journal", "exercises", "routines"];
export const humanosSource = (found: Record<string, { records: AirtableRecord[] } | undefined>): HumanosSource => ({ journal: found.journal?.records ?? [], exercises: found.exercises?.records ?? [], routines: found.routines?.records ?? [] });
/** "65 × 10" for the dry run. */
export const fmtSetLine = (s: SetLine) => `${s.weight == null ? "BW" : s.weight} × ${s.reps}`;
