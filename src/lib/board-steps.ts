/**
 * My Board's step tasks, read live (rev 664 §6): what Today's check-in line and the scoreboard's "Board steps" line count. Apart
 * from src/lib/board.ts (which reads the scoreboard) so the two never import each other. Counts only; never a decision's words
 * beyond the member's own.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";

type Member = { workspaceId: string; userId: string };

/** Every step task of the member's decisions, with the decision it belongs to (top-level id). */
export async function stepTasksOf(m: Member) {
  const ds = await db.query.boardDecisions.findMany({ where: and(eq(schema.boardDecisions.workspaceId, m.workspaceId), eq(schema.boardDecisions.userId, m.userId)), columns: { id: true, parentId: true, question: true, answer: true, stepTasks: true } });
  const ids = ds.flatMap((d) => d.stepTasks.filter((x): x is string => Boolean(x)));
  const tasks = ids.length ? await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, m.userId), inArray(schema.tasks.id, ids)), columns: { id: true, status: true, dueDate: true, completedAt: true } }) : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return ds.flatMap((d) => d.stepTasks.map((id, index) => (id && byId.get(id) ? { decision: d, index, task: byId.get(id)! } : null)).filter((x): x is NonNullable<typeof x> => Boolean(x)));
}

/** Today's line (rev 664 §6): each decision with steps due or overdue and still open. */
export async function checkinsDue(v: Viewer): Promise<{ id: string; decision: string; due: number }[]> {
  const steps = await stepTasksOf({ workspaceId: v.workspace.id, userId: v.user.id });
  const open = steps.filter((s) => s.task.status !== "done" && s.task.dueDate && s.task.dueDate <= v.today);
  const by = new Map<string, { id: string; decision: string; due: number }>();
  for (const s of open) {
    const top = s.decision.parentId ?? s.decision.id;
    const cur = by.get(top) ?? { id: top, decision: s.decision.answer?.decision ?? s.decision.question, due: 0 };
    cur.due++;
    by.set(top, cur);
  }
  return [...by.values()];
}

/** The scoreboard's line and the coach's count: steps due in the week and how many are done; open steps past their date. */
export async function boardStepsFor(m: Member, from: string, to: string, today: string): Promise<{ due: number; done: number; overdue: number }> {
  const steps = await stepTasksOf(m);
  const inWeek = steps.filter((s) => s.task.dueDate && s.task.dueDate >= from && s.task.dueDate <= to);
  return {
    due: inWeek.length,
    done: inWeek.filter((s) => s.task.status === "done").length,
    overdue: steps.filter((s) => s.task.status !== "done" && s.task.dueDate && s.task.dueDate < today).length,
  };
}

/* ───────────────────────── Shared with the coach (rev 664 §7) ───────────────────────── */

export type SharedDecision = { id: string; member: string; sharedAt: string; question: string; answer: schema.BoardDecision["answer"]; followUps: { question: string; recommendation: string | null }[] };

/** The coach's "Office Hours: shared decisions": only what a member chose to share, in this workspace, newest first. */
export async function sharedDecisionsFor(workspaceId: string): Promise<SharedDecision[]> {
  const shared = await db.query.boardDecisions.findMany({ where: and(eq(schema.boardDecisions.workspaceId, workspaceId), isNotNull(schema.boardDecisions.sharedAt)), orderBy: desc(schema.boardDecisions.sharedAt) });
  const tops = shared.filter((d) => !d.parentId);
  if (!tops.length) return [];
  const users = await db.query.users.findMany({ where: inArray(schema.users.id, [...new Set(tops.map((d) => d.userId))]), columns: { id: true, name: true } });
  const follows = await db.query.boardDecisions.findMany({ where: and(eq(schema.boardDecisions.workspaceId, workspaceId), inArray(schema.boardDecisions.parentId, tops.map((d) => d.id))), orderBy: [schema.boardDecisions.createdAt] });
  return tops.map((d) => ({
    id: d.id,
    member: users.find((u) => u.id === d.userId)?.name ?? "A member",
    sharedAt: d.sharedAt!,
    question: d.question,
    answer: d.answer,
    followUps: follows.filter((f) => f.parentId === d.id && f.userId === d.userId).map((f) => ({ question: f.question, recommendation: f.answer?.recommendation ?? null })),
  }));
}
