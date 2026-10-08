import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { planTree, type LinkRow, type PlanRow, type PlanTree, type TaskRef } from "@/lib/engine/plan";
import { recordPace, type KpiRead, type Pace, type ValueRow } from "@/lib/engine/kpi";
import { ensurePrimaryKpi, kpiReads } from "@/lib/queries/kpi";

export type Member = { workspaceId: string; userId: string };
const mine = (m: Member) => and(eq(schema.planRecords.workspaceId, m.workspaceId), eq(schema.planRecords.userId, m.userId));

/**
 * The member's Primary business goal (Danno, 6 Oct: Today's one goal becomes it, so nothing a client set is lost): the plan
 * record that mirrors the primary goals row, made on first read when the member has that row and no mirror yet; then its KPI
 * (BG2): the goals row's target and actual are read through it, as Cash collected for a "$" goal.
 */
export async function ensurePrimaryGoal(m: Member, today: string): Promise<void> {
  const legacy = await db.query.goals.findFirst({ where: and(eq(schema.goals.workspaceId, m.workspaceId), eq(schema.goals.userId, m.userId), eq(schema.goals.primary, true)) });
  if (!legacy) return;
  const had = await db.query.planRecords.findFirst({ where: and(mine(m), eq(schema.planRecords.goalId, legacy.id)), columns: { id: true } });
  if (!had) await db.insert(schema.planRecords).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, kind: "goal", title: legacy.title, status: "on_track", primary: true, goalId: legacy.id, dueDate: legacy.dueDate ?? null, notes: `${legacy.unit === "$" ? "$" : ""}${legacy.target.toLocaleString()}${legacy.unit !== "$" ? ` ${legacy.unit}` : ""} · ${legacy.period}` });
  await ensurePrimaryKpi(m, today);
}

/** Each record's pace from its KPIs (BG2): the reads grouped by record. */
export function pacesOf(reads: readonly KpiRead[]): Record<string, Pace> {
  const byRecord = new Map<string, KpiRead[]>();
  for (const r of reads) byRecord.set(r.kpi.recordId, [...(byRecord.get(r.kpi.recordId) ?? []), r]);
  return Object.fromEntries([...byRecord].map(([id, rs]) => [id, recordPace(rs)]));
}

/**
 * Everything the plan's pages read, the member's own: the records, the links, the tasks the initiatives link to, and the
 * KPIs read for the day (BG2), with the tree's pace from them.
 */
export async function planData(m: Member, today: string): Promise<{ records: PlanRow[]; links: LinkRow[]; tasks: TaskRef[]; tree: PlanTree; reads: KpiRead[]; logs: ({ date: string } & Record<string, unknown>)[]; values: ValueRow[] }> {
  const [records, links, { reads, logs, values }] = await Promise.all([
    db.query.planRecords.findMany({ where: mine(m), orderBy: [asc(schema.planRecords.order), asc(schema.planRecords.createdAt)] }),
    db.query.planLinks.findMany({ where: and(eq(schema.planLinks.workspaceId, m.workspaceId), eq(schema.planLinks.userId, m.userId)) }),
    kpiReads(m, today),
  ]);
  const taskIds = links.filter((l) => l.toKind === "task").map((l) => l.toId);
  const tasks = taskIds.length ? await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, m.userId), inArray(schema.tasks.id, taskIds)) }) : [];
  const taskRefs: TaskRef[] = tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate }));
  const linkRows: LinkRow[] = links.map((l) => ({ fromId: l.fromId, toKind: l.toKind, toId: l.toId }));
  return { records, links: linkRows, tasks: taskRefs, tree: planTree(records, linkRows, taskRefs, pacesOf(reads)), reads, logs, values };
}

/** One record of the member's own, or null. */
export async function ownRecord(m: Member, id: string): Promise<PlanRow | null> {
  return (await db.query.planRecords.findFirst({ where: and(mine(m), eq(schema.planRecords.id, id)) })) ?? null;
}
