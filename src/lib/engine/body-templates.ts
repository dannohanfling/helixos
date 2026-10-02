/**
 * Coach templates and the weekly check-in (B9, rev 237; revs 196, 200, 353), pure. A template is a snapshot of one of the
 * coach's own day types, saved meals (with the foods it needs) or routines (with the exercises), sent one way: the client gets
 * their own copy to edit, and the coach reads nothing of the client's. A check-in is the week's numbers as lines (the same
 * lines the AI summary gets) plus one note in the member's words, sent even with sharing off; the coach sees only what was sent.
 */
import type { FoodSection } from "@/db/schema";

export const TEMPLATE_KINDS = ["day_type", "meal", "routine"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const KIND_LABEL: Record<TemplateKind, string> = { day_type: "Day type", meal: "Meal", routine: "Routine" };
export const isTemplateKind = (k: string): k is TemplateKind => (TEMPLATE_KINDS as readonly string[]).includes(k);
/** Where a client sees a send of each kind, beside Log. */
export const KIND_PAGE: Record<TemplateKind, string> = { day_type: "/body/settings#day-types", meal: "/body/foods#meals", routine: "/body/training/routines#routines" };

export type DayTypeTemplate = { name: string; calMin: number | null; calMax: number | null; pMin: number | null; pMax: number | null; fMin: number | null; fMax: number | null; cMin: number | null; cMax: number | null; reminder: string | null };
export type FoodTemplate = { name: string; unit: string; cal: number; p: number; f: number; c: number; sodium: number; capTag: string | null; basis: "cooked" | "raw"; section: FoodSection | null };
export type MealTemplate = { name: string; slot: string | null; items: { qty: number; food: FoodTemplate }[] };
export type ExerciseTemplate = { name: string; kind: "weight" | "bodyweight" };
export type RoutineTemplate = { name: string; items: { sets: number; reps: string; exercise: ExerciseTemplate }[] };
export type TemplatePayload = { kind: "day_type"; dayType: DayTypeTemplate } | { kind: "meal"; meal: MealTemplate } | { kind: "routine"; routine: RoutineTemplate };

type DayTypeRow = DayTypeTemplate;
type FoodRow = FoodTemplate & { id: string };
type MealRow = { name: string; slot: string | null; items: { foodId: string; qty: number }[] };
type ExerciseRow = ExerciseTemplate & { id: string };
type RoutineRow = { name: string; items: { exerciseId: string; sets: number; reps: string }[] };

export const dayTypeTemplate = (t: DayTypeRow): TemplatePayload => ({ kind: "day_type", dayType: { name: t.name, calMin: t.calMin, calMax: t.calMax, pMin: t.pMin, pMax: t.pMax, fMin: t.fMin, fMax: t.fMax, cMin: t.cMin, cMax: t.cMax, reminder: t.reminder } });
/** A meal with every food it needs copied in; a line whose food is gone is left out, and a meal with no lines left is nothing to send. */
export function mealTemplate(m: MealRow, foods: FoodRow[]): TemplatePayload | null {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const items = m.items.flatMap((i) => {
    const f = byId.get(i.foodId);
    return f ? [{ qty: i.qty, food: { name: f.name, unit: f.unit, cal: f.cal, p: f.p, f: f.f, c: f.c, sodium: f.sodium, capTag: f.capTag, basis: f.basis, section: f.section } }] : [];
  });
  return items.length ? { kind: "meal", meal: { name: m.name, slot: m.slot, items } } : null;
}
export function routineTemplate(r: RoutineRow, exercises: ExerciseRow[]): TemplatePayload | null {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const items = r.items.flatMap((i) => {
    const e = byId.get(i.exerciseId);
    return e ? [{ sets: i.sets, reps: i.reps, exercise: { name: e.name, kind: e.kind } }] : [];
  });
  return items.length ? { kind: "routine", routine: { name: r.name, items } } : null;
}

export const templateName = (p: TemplatePayload): string => (p.kind === "day_type" ? p.dayType.name : p.kind === "meal" ? p.meal.name : p.routine.name);
/** One line on what a send holds, for the coach's list and the client's card. */
export function templateSummary(p: TemplatePayload): string {
  if (p.kind === "day_type") {
    const t = p.dayType;
    const band = (lo: number | null, hi: number | null, label: string) => (lo != null && hi != null ? `${label} ${lo}–${hi}` : "");
    const parts = [band(t.calMin, t.calMax, "cal"), band(t.pMin, t.pMax, "P"), band(t.fMin, t.fMax, "F"), band(t.cMin, t.cMax, "C")].filter(Boolean);
    return `${parts.length ? parts.join(" · ") : "no bands"}${t.reminder ? ` · "${t.reminder}"` : ""}`;
  }
  if (p.kind === "meal") {
    const cal = Math.round(p.meal.items.reduce((a, i) => a + i.qty * i.food.cal, 0));
    return `${p.meal.items.length} food${p.meal.items.length === 1 ? "" : "s"} · about ${cal} cal${p.meal.slot ? ` · ${p.meal.slot}` : ""}`;
  }
  return `${p.routine.items.length} exercise${p.routine.items.length === 1 ? "" : "s"}: ${p.routine.items.map((i) => `${i.exercise.name} ${i.sets}×${i.reps || "?"}`).join(", ")}`;
}

const key = (s: string) => s.trim().toLowerCase();
/** The client's own row of that name, case aside, or null. */
export const sameName = <T extends { name: string }>(name: string, rows: T[]): T | null => rows.find((r) => key(r.name) === key(name)) ?? null;
/** The copy's name: the template's own, or, when the client already has one by that name, with the coach's first name added. */
export const copyName = (name: string, taken: { name: string }[], coachName: string): string => (sameName(name, taken) ? `${name} (from ${coachName.trim().split(/\s+/)[0] || "coach"})` : name);

/** A check-in's note: trimmed, one paragraph, 500 characters at most. */
export const checkinNote = (raw: string): string => raw.replace(/\s+/g, " ").trim().slice(0, 500);
/** A week's Monday is a Monday on or before the week that holds `today`. */
export const checkinWeekOk = (monday: string, today: string, startOfWeek: (d: string) => string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(monday) && startOfWeek(monday) === monday && monday <= startOfWeek(today);
