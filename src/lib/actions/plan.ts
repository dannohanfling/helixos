"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { PLAN_KINDS, PLAN_STATUSES, type PlanKind, type PlanStatus } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { addTask } from "@/lib/tasks-core";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { linkAllowed } from "@/lib/engine/plan";
import { ownRecord } from "@/lib/queries/plan";

/**
 * Business goals (BG1): the member's own records and links, scoped to the workspace and member on every write. A link goes
 * one level down and never to another member's record or task. Nothing here is Body's.
 */
const kindOf = (v: string): PlanKind => (PLAN_KINDS.find((k) => k === v) ?? "goal");
const statusOf = (v: string): PlanStatus => (PLAN_STATUSES.find((k) => k === v) ?? "not_started");
const money = (v: string | null): number | null => { if (!v) return null; const n = Number(v.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; };
const fields = (f: FormData) => ({
  title: str(f, "title").trim().slice(0, 300),
  status: statusOf(str(f, "status")),
  owner: opt(f, "owner")?.trim().slice(0, 120) || null,
  dueDate: /^\d{4}-\d{2}-\d{2}$/.test(str(f, "dueDate")) ? str(f, "dueDate") : null,
  notes: opt(f, "notes")?.trim().slice(0, 4000) || null,
  pathwayStage: opt(f, "pathwayStage")?.trim().slice(0, 80) || null,
  budget: money(opt(f, "budget")),
  hireTrigger: opt(f, "hireTrigger")?.trim().slice(0, 300) || null,
});

/** A new record; linked under its parent when one is named (a goal for a key result, a key result for an initiative). */
export async function createPlanRecordAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const m = { workspaceId, userId };
  const kind = kindOf(str(formData, "kind"));
  const f = fields(formData);
  if (!f.title) redirect(`/goals?error=${encodeURIComponent("Give it a title.")}`);
  const id = newId();
  await db.insert(schema.planRecords).values({ id, workspaceId, userId, kind, ...f });
  const parentId = str(formData, "parentId");
  if (parentId) {
    const parent = await ownRecord(m, parentId);
    if (parent && linkAllowed(parent, { kind })) await db.insert(schema.planLinks).values({ id: newId(), workspaceId, userId, fromId: parent.id, toKind: "record", toId: id }).onConflictDoNothing();
  }
  refresh();
  redirect(str(formData, "back") || `/goals/${id}`);
}

export async function updatePlanRecordAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const r = await ownRecord({ workspaceId, userId }, str(formData, "id"));
  if (!r) return;
  const f = fields(formData);
  if (!f.title) return;
  await db.update(schema.planRecords).set(f).where(and(eq(schema.planRecords.id, r.id), eq(schema.planRecords.userId, userId)));
  refresh();
}

/** Archived, never deleted: its links stay, and it comes off the tree and the table. */
export async function archivePlanRecordAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const r = await ownRecord({ workspaceId, userId }, str(formData, "id"));
  if (!r || r.primary) return;
  await db.update(schema.planRecords).set({ archivedAt: nowIso() }).where(and(eq(schema.planRecords.id, r.id), eq(schema.planRecords.userId, userId)));
  refresh();
  redirect("/goals");
}

/** A link from one record down to another of the member's own (goal → key result, key result → initiative), from either side. */
export async function linkPlanRecordsAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const m = { workspaceId, userId };
  const [from, to] = await Promise.all([ownRecord(m, str(formData, "fromId")), ownRecord(m, str(formData, "toId"))]);
  if (!from || !to || !linkAllowed(from, to)) return;
  await db.insert(schema.planLinks).values({ id: newId(), workspaceId, userId, fromId: from.id, toKind: "record", toId: to.id }).onConflictDoNothing();
  refresh();
}

export async function unlinkPlanAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const fromId = str(formData, "fromId");
  const toId = str(formData, "toId");
  if (!fromId || !toId) return;
  await db.delete(schema.planLinks).where(and(eq(schema.planLinks.workspaceId, workspaceId), eq(schema.planLinks.userId, userId), eq(schema.planLinks.fromId, fromId), eq(schema.planLinks.toId, toId)));
  refresh();
}

/** An initiative's task: made through the tasks' own rules, then linked; or an existing task of the member's, linked. */
export async function linkPlanTaskAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
  const m = { workspaceId, userId };
  const from = await ownRecord(m, str(formData, "fromId"));
  if (!from || !linkAllowed(from, "task")) return;
  let taskId = str(formData, "taskId");
  if (!taskId) {
    const made = await addTask(v, { title: str(formData, "title"), dueDate: opt(formData, "dueDate"), urgency: "medium", category: "system" });
    if (!made) return;
    taskId = made.task.id;
  }
  const task = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)), columns: { id: true } });
  if (!task) return;
  await db.insert(schema.planLinks).values({ id: newId(), workspaceId, userId, fromId: from.id, toKind: "task", toId: task.id }).onConflictDoNothing();
  refresh();
}
