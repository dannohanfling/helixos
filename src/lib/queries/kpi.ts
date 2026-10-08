import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Kpi, KpiPeriod } from "@/db/schema";
import { newId } from "@/lib/ids";
import { periodWindow, readKpi, type KpiRead, type ValueRow } from "@/lib/engine/kpi";
import { logsBetween } from "@/lib/queries/daily";
import type { Member } from "@/lib/queries/plan";

/**
 * Business goals BG2: the member's KPIs, read where their sources say (a Numbers counter summed from the daily logs, or the
 * values typed by hand or asked for in the close), scoped to the workspace and member on every read and write.
 */
const mine = (m: Member) => and(eq(schema.kpis.workspaceId, m.workspaceId), eq(schema.kpis.userId, m.userId));

/** The member's live KPIs, oldest first. */
export async function kpisOf(m: Member): Promise<Kpi[]> {
  return db.query.kpis.findMany({ where: and(mine(m), isNull(schema.kpis.archivedAt)), orderBy: [asc(schema.kpis.createdAt)] });
}
/** One KPI of the member's own, live or archived, or null. */
export async function ownKpi(m: Member, id: string): Promise<Kpi | null> {
  return (await db.query.kpis.findFirst({ where: and(mine(m), eq(schema.kpis.id, id)) })) ?? null;
}

/** Every live KPI read on a day, with the logs and values each needs, in one pass; the chart reads the same rows. */
export async function kpiReads(m: Member, today: string): Promise<{ reads: KpiRead[]; logs: Record<string, unknown>[] & { date: string }[]; values: ValueRow[] }> {
  const kpis = await kpisOf(m);
  if (!kpis.length) return { reads: [], logs: [], values: [] };
  const windows = kpis.map((k) => periodWindow(k, today));
  const from = windows.map((w) => w.from).sort()[0];
  const to = windows.map((w) => w.to).sort().at(-1)!;
  const [logs, values] = await Promise.all([
    kpis.some((k) => k.source === "numbers") ? logsBetween(m.workspaceId, m.userId, from, to) : Promise.resolve([]),
    db.query.kpiValues.findMany({ where: and(eq(schema.kpiValues.workspaceId, m.workspaceId), eq(schema.kpiValues.userId, m.userId), inArray(schema.kpiValues.kpiId, kpis.map((k) => k.id))) }),
  ]);
  const valueRows: ValueRow[] = values.map((v) => ({ kpiId: v.kpiId, date: v.date, value: v.value }));
  return { reads: kpis.map((k) => readKpi(k, today, logs, valueRows)), logs, values: valueRows };
}

/** The period Settings' free text means: "This quarter" and "This year" read as such, anything else is the month. */
export function periodOfText(period: string | null | undefined): KpiPeriod {
  const p = (period ?? "").toLowerCase();
  return p.includes("quarter") ? "quarter" : p.includes("year") ? "year" : p.includes("week") ? "week" : "month";
}

/**
 * The Primary business goal's own KPI (Danno, 6 Oct: Today's one goal becomes it): for a "$" goal, Cash collected read from
 * the closes (the Numbers counter, never typed twice); for any other unit, a KPI by hand named as the goal is, seeded with
 * Settings' "So far". Made once, the first time the member's plan is read after the mirror exists.
 */
export async function ensurePrimaryKpi(m: Member, today: string): Promise<void> {
  const record = await db.query.planRecords.findFirst({ where: and(eq(schema.planRecords.workspaceId, m.workspaceId), eq(schema.planRecords.userId, m.userId), eq(schema.planRecords.primary, true)), columns: { id: true, goalId: true } });
  if (!record?.goalId) return;
  const had = await db.query.kpis.findFirst({ where: and(mine(m), eq(schema.kpis.recordId, record.id)), columns: { id: true } });
  if (had) return;
  const legacy = await db.query.goals.findFirst({ where: and(eq(schema.goals.userId, m.userId), eq(schema.goals.id, record.goalId)) });
  if (!legacy) return;
  const id = newId();
  const period = periodOfText(legacy.period);
  if (legacy.unit === "$") {
    await db.insert(schema.kpis).values({ id, workspaceId: m.workspaceId, userId: m.userId, recordId: record.id, name: "Cash collected", unit: "$", target: legacy.target, period, source: "numbers", metric: "cashCollected" });
    return;
  }
  await db.insert(schema.kpis).values({ id, workspaceId: m.workspaceId, userId: m.userId, recordId: record.id, name: legacy.title, unit: legacy.unit, target: legacy.target, period, source: "manual" });
  if (legacy.actual > 0) await db.insert(schema.kpiValues).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, kpiId: id, date: periodWindow({ period, periodStart: null, periodEnd: null }, today).from, value: legacy.actual });
}

/**
 * Settings → Your one goal saved: the Primary business goal carries the title, and its KPI the target, the unit and the period;
 * for a KPI by hand, "So far" becomes this period's total (the period's values are replaced by one row at its start).
 */
export async function syncPrimaryKpi(m: Member, legacy: { id: string; title: string; target: number; actual: number; unit: string; period: string }, today: string): Promise<void> {
  const record = await db.query.planRecords.findFirst({ where: and(eq(schema.planRecords.workspaceId, m.workspaceId), eq(schema.planRecords.userId, m.userId), eq(schema.planRecords.primary, true), eq(schema.planRecords.goalId, legacy.id)), columns: { id: true } });
  if (!record) return;
  await db.update(schema.planRecords).set({ title: legacy.title }).where(and(eq(schema.planRecords.id, record.id), eq(schema.planRecords.userId, m.userId)));
  const kpi = await db.query.kpis.findFirst({ where: and(mine(m), eq(schema.kpis.recordId, record.id), isNull(schema.kpis.archivedAt)), orderBy: [asc(schema.kpis.createdAt)] });
  if (!kpi) return ensurePrimaryKpi(m, today);
  const period = periodOfText(legacy.period);
  const cash = legacy.unit === "$";
  await db.update(schema.kpis).set({ target: legacy.target, unit: legacy.unit, period, name: cash ? "Cash collected" : legacy.title, source: cash ? "numbers" : kpi.source === "numbers" ? "manual" : kpi.source, metric: cash ? "cashCollected" : null }).where(and(eq(schema.kpis.id, kpi.id), eq(schema.kpis.userId, m.userId)));
  if (cash) return;
  const w = periodWindow({ period, periodStart: null, periodEnd: null }, today);
  const rows = await db.query.kpiValues.findMany({ where: and(eq(schema.kpiValues.userId, m.userId), eq(schema.kpiValues.kpiId, kpi.id)) });
  const inWindow = rows.filter((r) => r.date >= w.from && r.date <= w.to);
  if (inWindow.length) await db.delete(schema.kpiValues).where(and(eq(schema.kpiValues.userId, m.userId), inArray(schema.kpiValues.id, inWindow.map((r) => r.id))));
  if (legacy.actual > 0) await db.insert(schema.kpiValues).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, kpiId: kpi.id, date: w.from, value: legacy.actual });
}

/** Today's bar: the Primary business goal and its first KPI, read for the day; null without a primary goal. */
export async function primaryGoalBar(m: Member, today: string): Promise<{ recordId: string; title: string; name: string; actual: number; target: number; unit: string; pace: KpiRead["pace"] } | null> {
  const record = await db.query.planRecords.findFirst({ where: and(eq(schema.planRecords.workspaceId, m.workspaceId), eq(schema.planRecords.userId, m.userId), eq(schema.planRecords.primary, true)), columns: { id: true, title: true } });
  if (!record) return null;
  const { reads } = await kpiReads(m, today);
  const first = reads.find((r) => r.kpi.recordId === record.id);
  if (!first) return { recordId: record.id, title: record.title, name: "", actual: 0, target: 0, unit: "", pace: "none" };
  return { recordId: record.id, title: record.title, name: first.kpi.name, actual: first.actual, target: first.kpi.target, unit: first.kpi.unit, pace: first.pace };
}

/** The KPIs the evening close asks for (source "close"), with today's value if one was typed. */
export async function closeKpisOf(m: Member, today: string): Promise<{ id: string; name: string; unit: string; value: number | null }[]> {
  const kpis = (await kpisOf(m)).filter((k) => k.source === "close");
  if (!kpis.length) return [];
  const values = await db.query.kpiValues.findMany({ where: and(eq(schema.kpiValues.userId, m.userId), eq(schema.kpiValues.date, today), inArray(schema.kpiValues.kpiId, kpis.map((k) => k.id))) });
  return kpis.map((k) => ({ id: k.id, name: k.name, unit: k.unit, value: values.find((v) => v.kpiId === k.id)?.value ?? null }));
}

/** One value for a KPI on a day, replacing the day's earlier one; the KPI must be the member's own and not a Numbers one. */
export async function putKpiValue(m: Member, kpi: Pick<Kpi, "id" | "source" | "userId">, date: string, value: number): Promise<void> {
  if (kpi.source === "numbers" || kpi.userId !== m.userId) return;
  await db.insert(schema.kpiValues).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, kpiId: kpi.id, date, value }).onConflictDoUpdate({ target: [schema.kpiValues.kpiId, schema.kpiValues.date], set: { value } });
}
