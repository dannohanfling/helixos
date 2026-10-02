/**
 * The coach's Airtable backfill (rev 441): reading the Omnichannel base and writing the approved plan. The token arrives with the
 * request and goes nowhere else (src/lib/airtable.ts). Read: the Client Feedback and Client Support rows, and the members table's
 * email field alone, by id. Written: monthly feedback for months a member doesn't already have, and Office Hours requests by their
 * Airtable record id, so a second run adds nothing.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { readOneField, readTables, type BaseAccess } from "@/lib/airtable";
import { FEEDBACK_TABLE, MEMBER_EMAIL_FIELD, MEMBERS_TABLE_ID, SUPPORT_TABLE, type BackfillExisting, type BackfillPlan, type BackfillSource, type Member } from "@/lib/engine/coach-backfill";
import { newId } from "@/lib/ids";

export async function readBackfill(access: BaseAccess): Promise<{ source: BackfillSource; missing: string[] }> {
  const r = await readTables(access, [FEEDBACK_TABLE, SUPPORT_TABLE]);
  const emails = await readOneField(access, MEMBERS_TABLE_ID, MEMBER_EMAIL_FIELD);
  return { source: { feedback: r.found[FEEDBACK_TABLE]?.records ?? [], support: r.found[SUPPORT_TABLE]?.records ?? [], emails }, missing: r.missing };
}

/** Everyone in the workspace, by email, to place each row on its member. */
export async function workspaceMembers(workspaceId: string): Promise<Member[]> {
  const rows = await db.select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.workspaceId, workspaceId));
  return rows.map((r) => ({ userId: r.userId, email: r.email, name: r.name }));
}

export async function existingBackfill(workspaceId: string): Promise<BackfillExisting> {
  const [feedback, ooh] = await Promise.all([
    db.query.monthlyFeedback.findMany({ where: eq(schema.monthlyFeedback.workspaceId, workspaceId), columns: { userId: true, month: true } }),
    db.query.officeHoursRequests.findMany({ where: and(eq(schema.officeHoursRequests.workspaceId, workspaceId), isNotNull(schema.officeHoursRequests.airtableId)), columns: { airtableId: true } }),
  ]);
  return { feedbackMonths: new Set(feedback.map((f) => `${f.userId}|${f.month}`)), oohIds: new Set(ooh.map((o) => o.airtableId!)) };
}

/**
 * Write the approved plan. Both writes ignore a row already there (a month the member has, a record id already in), so a run
 * that crosses a member's own save, or a second press, adds nothing. Each row is dated when it was sent, both created and
 * updated, so the coach's "new" counts stay quiet for history.
 */
export async function applyBackfill(plan: BackfillPlan, workspaceId: string): Promise<{ written: number }> {
  const feedback = plan.feedback
    .filter((f) => f.status === "new")
    .map((f) => ({ id: newId(), workspaceId, userId: f.userId, month: f.month, proud: f.proud, love: f.love, less: f.less, more: f.more, wow: f.wow, referralScore: f.referralScore, referral: f.referral, favorite: f.favorite, createdAt: f.createdAt, updatedAt: f.createdAt }));
  const ooh = plan.ooh
    .filter((o) => o.status === "new")
    .map((o) => ({ id: newId(), workspaceId, userId: o.userId, friday: o.friday, description: o.description, triedSelf: o.triedSelf, tools: o.tools, goal: o.goal, category: o.category, responsible: o.responsible, outcome: o.outcome, coachNotes: o.coachNotes, airtableId: o.recordId, createdAt: o.createdAt, updatedAt: o.createdAt }));
  let written = 0;
  for (let i = 0; i < feedback.length; i += 100) written += (await db.insert(schema.monthlyFeedback).values(feedback.slice(i, i + 100)).onConflictDoNothing().returning({ id: schema.monthlyFeedback.id })).length;
  for (let i = 0; i < ooh.length; i += 100) written += (await db.insert(schema.officeHoursRequests).values(ooh.slice(i, i + 100)).onConflictDoNothing().returning({ id: schema.officeHoursRequests.id })).length;
  return { written };
}
