/**
 * The intention chain (H-195 #14, Danno's H-198): a week's intention ties to an initiative in Business goals, and each of its key
 * results to one of the member's key results there. The Friday number is logged as a dated value on that key result's typed KPI,
 * only what the member wrote, never a guess. Every read and write is scoped to the member; a link is only to their own record of
 * the right kind. Nothing is linked without the member choosing it.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { putKpiValue } from "@/lib/queries/kpi";
import { weekOf } from "@/lib/engine/intentions";
import { monthOf } from "@/lib/engine/month-intentions";

type Member = { workspaceId: string; userId: string };
const mine = <T extends { workspaceId: unknown; userId: unknown }>(t: T, m: Member) => and(eq(t.workspaceId as never, m.workspaceId), eq(t.userId as never, m.userId));

export type PlanChoice = { id: string; title: string };

/** The member's live initiatives and key results, for the two pickers. */
export async function planChoices(m: Member): Promise<{ initiatives: PlanChoice[]; keyResults: PlanChoice[] }> {
  const rows = await db.query.planRecords.findMany({ where: and(mine(schema.planRecords, m), isNull(schema.planRecords.archivedAt)), columns: { id: true, kind: true, title: true, status: true, order: true } });
  const live = rows.filter((r) => r.status !== "dropped").sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const pick = (kind: string) => live.filter((r) => r.kind === kind).map((r) => ({ id: r.id, title: r.title }));
  return { initiatives: pick("initiative"), keyResults: pick("key_result") };
}

/** Link this week (the member's own choice): an initiative, and a key result per slot; anything not theirs, or of the wrong kind, is left unlinked. */
export async function linkWeek(m: Member, weekId: string, initiativeId: string | null, krIds: (string | null)[]): Promise<boolean> {
  const week = await db.query.weeklyIntentions.findFirst({ where: and(mine(schema.weeklyIntentions, m), eq(schema.weeklyIntentions.id, weekId)) });
  if (!week) return false;
  const { initiatives, keyResults } = await planChoices(m);
  const init = initiativeId && initiatives.some((r) => r.id === initiativeId) ? initiativeId : null;
  const krs = week.keyResults.map((k, i) => {
    const id = krIds[i];
    const { krId: _old, ...rest } = k;
    void _old;
    return id && keyResults.some((r) => r.id === id) ? { ...rest, krId: id } : rest;
  });
  await db.update(schema.weeklyIntentions).set({ initiativeId: init, keyResults: krs }).where(and(mine(schema.weeklyIntentions, m), eq(schema.weeklyIntentions.id, weekId)));
  return true;
}

/**
 * The Friday numbers into Business goals: each linked key result with a number written logs it, dated `date`, on every typed
 * KPI (manual or close) of that key result. A Numbers KPI sums the daily log and is never written. Returns how many were logged.
 */
export async function logWeekActuals(m: Member, week: Pick<schema.WeeklyIntention, "keyResults">, date: string): Promise<number> {
  const linked = week.keyResults.filter((k) => k.krId && typeof k.actual === "number");
  if (!linked.length) return 0;
  const kpis = await db.query.kpis.findMany({ where: and(mine(schema.kpis, m), inArray(schema.kpis.recordId, linked.map((k) => k.krId!)), isNull(schema.kpis.archivedAt)) });
  let n = 0;
  for (const k of linked) {
    for (const kpi of kpis.filter((x) => x.recordId === k.krId && x.source !== "numbers")) {
      await putKpiValue(m, kpi, date, k.actual!);
      n++;
    }
  }
  return n;
}

export type Chain = {
  initiative: PlanChoice | null;
  month: { word: string } | null;
  week: { id: string; word: string; weekOf: string } | null;
  tasks: { done: number; total: number };
  keyResults: { text: string; kr: PlanChoice | null; actual: number | null }[];
  moved: number;
};

/** This week's chain, top to bottom: initiative, this month's intention, this week's, its tasks, its key results. */
export async function chainFor(m: Member, today: string): Promise<Chain> {
  const [week, month, choices] = await Promise.all([
    db.query.weeklyIntentions.findFirst({ where: and(mine(schema.weeklyIntentions, m), eq(schema.weeklyIntentions.weekOf, weekOf(today))) }),
    db.query.monthlyIntentions.findFirst({ where: and(mine(schema.monthlyIntentions, m), eq(schema.monthlyIntentions.month, monthOf(today))) }),
    planChoices(m),
  ]);
  const ids = (week?.tasks ?? []).map((t) => t.taskId).filter((x): x is string => Boolean(x));
  const tasks = ids.length ? await db.query.tasks.findMany({ where: and(mine(schema.tasks, m), inArray(schema.tasks.id, ids)), columns: { status: true } }) : [];
  const keyResults = (week?.keyResults ?? []).map((k) => ({ text: k.text, kr: choices.keyResults.find((r) => r.id === k.krId) ?? null, actual: k.actual ?? null }));
  return {
    initiative: choices.initiatives.find((r) => r.id === week?.initiativeId) ?? null,
    month: month ? { word: month.word } : null,
    week: week ? { id: week.id, word: week.word, weekOf: week.weekOf } : null,
    tasks: { done: tasks.filter((t) => t.status === "done").length, total: (week?.tasks ?? []).length },
    keyResults,
    moved: keyResults.filter((k) => k.kr && k.actual !== null).length,
  };
}

/** The weeks that roll up under one initiative, newest first, with their tasks done of total. */
export async function weeksUnder(m: Member, initiativeId: string): Promise<{ id: string; weekOf: string; word: string; done: number; total: number }[]> {
  const weeks = await db.query.weeklyIntentions.findMany({ where: and(mine(schema.weeklyIntentions, m), eq(schema.weeklyIntentions.initiativeId, initiativeId)), orderBy: desc(schema.weeklyIntentions.weekOf), limit: 12 });
  const ids = weeks.flatMap((w) => w.tasks.map((t) => t.taskId)).filter((x): x is string => Boolean(x));
  const done = new Set(ids.length ? (await db.query.tasks.findMany({ where: and(mine(schema.tasks, m), inArray(schema.tasks.id, ids)), columns: { id: true, status: true } })).filter((t) => t.status === "done").map((t) => t.id) : []);
  return weeks.map((w) => ({ id: w.id, weekOf: w.weekOf, word: w.word, done: w.tasks.filter((t) => t.taskId && done.has(t.taskId)).length, total: w.tasks.length }));
}

/**
 * A task that is also on a week's intention is being deleted from Tasks: `both` takes it off the intention too; otherwise the
 * intention keeps its words and the slot is simply no longer linked. Returns whether it was on an intention at all.
 */
export async function unhookIntentionTask(m: Member, taskId: string, both: boolean): Promise<boolean> {
  const task = await db.query.tasks.findFirst({ where: and(mine(schema.tasks, m), eq(schema.tasks.id, taskId)), columns: { source: true, sourceRef: true } });
  if (!task || task.source !== "intention" || !task.sourceRef) return false;
  const week = await db.query.weeklyIntentions.findFirst({ where: and(mine(schema.weeklyIntentions, m), eq(schema.weeklyIntentions.weekOf, task.sourceRef)) });
  if (!week || !week.tasks.some((t) => t.taskId === taskId)) return false;
  const tasks = both ? week.tasks.filter((t) => t.taskId !== taskId) : week.tasks.map((t) => (t.taskId === taskId ? { ...t, taskId: null } : t));
  await db.update(schema.weeklyIntentions).set({ tasks }).where(and(mine(schema.weeklyIntentions, m), eq(schema.weeklyIntentions.id, week.id)));
  return true;
}
