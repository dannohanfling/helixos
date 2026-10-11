/**
 * The HumanOS voice pack (rev 653), the pure parts: matching what the member said to an exercise, turning "3 sets of 10 at 55",
 * "same as last time" or "as planned" into sets (or saying exactly what's missing, never guessing a number), the warm-up dry run,
 * the check-in's reply, and matching an old CSV's set notes to the sets HumanOS holds. No model, no advice.
 */
import { repsRange, type ExerciseKind, type WeightUnit } from "@/lib/engine/body-training";
import { parseCsvRows } from "@/lib/engine/body-scale";

/* ───────── Names ───────── */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bdb\b/g, "dumbbell")
    .replace(/\bbb\b/g, "barbell")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length >= 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));

export type NameMatch<T> = { kind: "one"; item: T } | { kind: "choices"; items: T[] } | { kind: "none" };

/**
 * What the member said, against their names: the exact name (case and punctuation aside) wins; else the names holding every word
 * said; else the names whose every word was said ("seated leg curl" for "Leg Curl" when only that is there). One is a match, more
 * are choices, none is none.
 */
export function matchName<T extends { name: string }>(said: string, items: T[]): NameMatch<T> {
  const want = norm(said);
  if (!want.length) return { kind: "none" };
  const key = want.join(" ");
  const exact = items.filter((x) => norm(x.name).join(" ") === key);
  if (exact.length === 1) return { kind: "one", item: exact[0] };
  if (exact.length > 1) return { kind: "choices", items: exact };
  const holds = items.filter((x) => {
    const n = norm(x.name);
    return want.every((w) => n.includes(w));
  });
  if (holds.length === 1) return { kind: "one", item: holds[0] };
  if (holds.length > 1) return { kind: "choices", items: holds.slice(0, 9) };
  const within = items.filter((x) => {
    const n = norm(x.name);
    return n.length > 0 && n.every((w) => want.includes(w));
  });
  if (within.length === 1) return { kind: "one", item: within[0] };
  if (within.length > 1) return { kind: "choices", items: within.slice(0, 9) };
  return { kind: "none" };
}

/** "1. Leg Curl\n2. Seated Leg Curl" */
export const numbered = (names: string[]) => names.map((n, i) => `${i + 1}. ${n}`).join("\n");

/* ───────── Sets from what was said ───────── */

export type SaidSet = { weight?: number | null; reps?: number | null };
export type ExerciseSaid = {
  sets?: SaidSet[];
  setsCount?: number;
  reps?: number;
  weight?: number;
  /** "same as last time" or "as planned". */
  same?: "last_time" | "planned";
  warmups?: SaidSet[];
};
export type Context = {
  kind: ExerciseKind;
  unit: WeightUnit;
  /** Last time's working sets, in the member's unit. */
  last: { weight: number | null; reps: number }[];
  lastDate: string | null;
  /** Today's planned line for this exercise, from the routine. */
  plan: { sets: number; reps: string; weight: number | null } | null;
  /** Next time's weight, set from a post-workout read or by voice. */
  next: number | null;
};
export type Resolved = { ok: true; sets: { weight: number | null; reps: number; warmup: boolean }[] } | { ok: false; needs: string[] };

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
const setText = (s: { weight: number | null; reps: number }, kind: ExerciseKind, unit: WeightUnit) => (kind === "bodyweight" ? (s.weight ? `${s.reps} reps +${num(s.weight)} ${unit}` : `${s.reps} reps`) : `${num(s.weight ?? 0)}×${s.reps}`);

/** "Last time: 55×10, 55×9, 50×10" · "Plan: 3×10 at 55" · "Next time's weight: 60". The lines that make a question easy. */
export function helpLines(c: Context): string[] {
  const out: string[] = [];
  if (c.last.length) out.push(`Last time${c.lastDate ? ` (${c.lastDate})` : ""}: ${c.last.map((s) => setText(s, c.kind, c.unit)).join(", ")}.`);
  if (c.plan) out.push(`Plan: ${c.plan.sets}×${c.plan.reps || "?"}${c.plan.weight != null ? ` at ${num(c.plan.weight)}` : c.next != null ? ` at ${num(c.next)}` : ""}.`);
  if (c.next != null && !(c.plan && c.plan.weight != null)) out.push(`Next time's weight: ${num(c.next)} ${c.unit}.`);
  return out;
}

/** What to ask for, by the exercise's kind: one short question each. */
export function needsFor(kind: ExerciseKind, unit: WeightUnit): string[] {
  if (kind === "timed") return ["How many minutes?", "And the distance, if it matters?"];
  if (kind === "bodyweight") return ["How many sets, and the reps in each?", `Any weight added (${unit})?`];
  return ["How many sets?", `The weight (${unit}) and reps for each, or one weight and reps for all?`];
}

const okReps = (r: unknown): r is number => typeof r === "number" && Number.isFinite(r) && r >= 1 && r <= 1000;
const okWeight = (w: unknown): w is number => typeof w === "number" && Number.isFinite(w) && w > 0 && w < 5000;

/**
 * The sets to log, or what's missing. Never invents a number: "same as last time" copies last time's working sets, "as planned"
 * takes the plan's sets and reps (a range like 8–10 needs the reps said) at its weight, else next time's weight; a weight exercise
 * needs a weight on every set, a bodyweight one only reps. Warm-ups go first and need their numbers the same way.
 */
export function resolveSets(said: ExerciseSaid, c: Context): Resolved {
  const needs = needsFor(c.kind, c.unit);
  let work: SaidSet[] = [];
  if (said.same === "last_time") {
    if (!c.last.length) return { ok: false, needs: ["There's no last time for this one yet.", ...needs] };
    work = c.last.map((s) => ({ weight: s.weight, reps: s.reps }));
  } else if (said.same === "planned") {
    if (!c.plan) return { ok: false, needs: ["It isn't in today's routine, so there's no plan to follow.", ...needs] };
    const r = repsRange(c.plan.reps);
    const reps = said.reps ?? (r && r[0] === r[1] ? r[0] : null);
    if (reps == null) return { ok: false, needs: [`The plan says ${c.plan.reps || "no set number of"} reps: how many did you do?`] };
    const weight = said.weight ?? c.plan.weight ?? c.next;
    work = Array.from({ length: c.plan.sets }, () => ({ weight: weight ?? null, reps }));
  } else if (said.sets?.length) {
    work = said.sets.map((s) => ({ weight: s.weight ?? said.weight ?? null, reps: s.reps ?? said.reps ?? null }));
  } else if (said.setsCount && said.reps) {
    work = Array.from({ length: Math.min(20, Math.round(said.setsCount)) }, () => ({ weight: said.weight ?? null, reps: said.reps! }));
  } else {
    return { ok: false, needs };
  }
  const all = [...(said.warmups ?? []).map((s) => ({ ...s, warmup: true })), ...work.map((s) => ({ ...s, warmup: false }))];
  if (all.some((s) => !okReps(s.reps))) return { ok: false, needs: [c.kind === "bodyweight" ? "The reps in each set?" : "The reps for each set?"] };
  if (c.kind === "weight" && all.some((s) => !okWeight(s.weight))) return { ok: false, needs: [`The weight (${c.unit}) for ${all.some((s) => okWeight(s.weight)) ? "every set" : "the sets"}?`] };
  return { ok: true, sets: all.map((s) => ({ weight: okWeight(s.weight) ? s.weight : null, reps: Math.round(s.reps as number), warmup: s.warmup })) };
}

/* ───────── Warm-ups ───────── */

/**
 * The warm-up dry run: on each day, an exercise's first set at under 60% of that day's top weight, when there's a heavier set after
 * it. Bodyweight sets with nothing added, and sets already marked, are left alone.
 */
export function warmupCandidates<T extends { id: string; date: string; exerciseId: string; weight: number | null; warmup: boolean }>(sets: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const s of sets) {
    const k = `${s.date}|${s.exerciseId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  const out: T[] = [];
  for (const g of groups.values()) {
    const first = g[0];
    if (first.warmup || first.weight == null || g.length < 2) continue;
    const top = Math.max(...g.map((s) => s.weight ?? 0));
    if (top > 0 && first.weight < top * 0.6) out.push(first);
  }
  return out;
}

/* ───────── How I feel ───────── */

export type Feeling = { energy: number | null; mood: number | null; soreness: "none" | "some" | "sore" | null; sorenessArea: string | null; sleepFeel: number | null };

/** "Energy 2 of 5, mood 3 of 5, slept 2 of 5, a bit sore (legs)." */
export function feelingLine(f: Feeling): string {
  const parts = [f.energy != null ? `energy ${f.energy} of 5` : "", f.mood != null ? `mood ${f.mood} of 5` : "", f.sleepFeel != null ? `slept ${f.sleepFeel} of 5` : "", f.soreness === "sore" ? `sore${f.sorenessArea ? ` (${f.sorenessArea})` : ""}` : f.soreness === "some" ? `a bit sore${f.sorenessArea ? ` (${f.sorenessArea})` : ""}` : f.soreness === "none" ? "not sore" : ""].filter(Boolean);
  return parts.length ? `${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : "";
}

/** The check-in's reply: what was saved, said back plainly, and a kind word. Never advice, never a diagnosis. */
export function feelingReply(f: Feeling): string {
  const low = [f.energy, f.mood, f.sleepFeel].some((n) => n != null && n <= 2) || f.soreness === "sore";
  const high = [f.energy, f.mood, f.sleepFeel].every((n) => n == null || n >= 4) && f.soreness !== "sore";
  const word = low ? "Thanks for checking in. Noted for today." : high ? "Good to hear. Noted for today." : "Noted for today.";
  return `${word} ${feelingLine(f)}`.trim();
}

/* ───────── Notes from the old CSV ───────── */

export type CsvNote = { row: number; date: string; exercise: string; set: number; note: string };

const HEAD = {
  date: /^(date|day|workout date)$/i,
  exercise: /^(exercise|exercise name|movement|lift)$/i,
  set: /^(set|set #|set number|set no\.?|set_number|setnumber)$/i,
  note: /^(notes?|comment|comments)$/i,
};

/** A date as written in a sheet: 2026-03-21, 3/21/2026, 21/03/2026 is read only when the day can't be a month. */
function sheetDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/**
 * The notes in a training_sets.csv: the columns found by their headings (date, exercise, set, notes), every row with a note kept.
 * Null when a heading is missing, with which one in `missing`.
 */
export function parseSetNotesCsv(text: string): { notes: CsvNote[]; rows: number } | { missing: string[] } {
  const rows = parseCsvRows(text);
  if (!rows.length) return { missing: ["date", "exercise", "set", "notes"] };
  const head = rows[0].map((h) => h.trim());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const at = { date: col(HEAD.date), exercise: col(HEAD.exercise), set: col(HEAD.set), note: col(HEAD.note) };
  const missing = Object.entries(at).filter(([, i]) => i < 0).map(([k]) => (k === "note" ? "notes" : k));
  if (missing.length) return { missing };
  const notes: CsvNote[] = [];
  rows.slice(1).forEach((r, i) => {
    const note = (r[at.note] ?? "").trim();
    const date = sheetDate(r[at.date] ?? "");
    const set = Number((r[at.set] ?? "").trim());
    const exercise = (r[at.exercise] ?? "").trim();
    if (note && date && exercise && Number.isInteger(set) && set >= 1) notes.push({ row: i + 2, date, exercise, set, note: note.slice(0, 300) });
  });
  return { notes, rows: rows.length - 1 };
}

export type NoteMatch = { row: number; setId: string; date: string; exercise: string; set: number; note: string; had: string | null };

/**
 * Each CSV note to a set: the same date, the exercise by name (as the import named it, so through `nameOf`), and the set's place
 * in that exercise's day (1 = its first set). A row with no such set, or a set that already holds this very note, is left out.
 */
export function matchSetNotes<S extends { id: string; date: string; exerciseId: string; note: string | null }>(notes: CsvNote[], sets: S[], exerciseName: (id: string) => string | undefined, nameOf: (csvName: string) => string = (n) => n): { matched: NoteMatch[]; unmatched: CsvNote[] } {
  const byDayEx = new Map<string, S[]>();
  for (const s of sets) {
    const name = exerciseName(s.exerciseId);
    if (!name) continue;
    const k = `${s.date}|${norm(name).join(" ")}`;
    if (!byDayEx.has(k)) byDayEx.set(k, []);
    byDayEx.get(k)!.push(s);
  }
  const matched: NoteMatch[] = [];
  const unmatched: CsvNote[] = [];
  for (const n of notes) {
    const day = byDayEx.get(`${n.date}|${norm(n.exercise).join(" ")}`) ?? byDayEx.get(`${n.date}|${norm(nameOf(n.exercise)).join(" ")}`);
    const s = day?.[n.set - 1];
    if (!s) unmatched.push(n);
    else if (s.note?.trim() !== n.note) matched.push({ row: n.row, setId: s.id, date: n.date, exercise: exerciseName(s.exerciseId)!, set: n.set, note: n.note, had: s.note });
  }
  return { matched, unmatched };
}
