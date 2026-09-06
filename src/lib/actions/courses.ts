"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { award } from "@/lib/queries/points";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";

export async function completeLessonAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const lessonId = str(formData, "lessonId");
  const lesson = await db.query.lessons.findFirst({ where: eq(schema.lessons.id, lessonId) });
  if (!lesson) return;
  const res = await db.insert(schema.lessonProgress).values({ id: newId(), workspaceId, userId, lessonId, note: opt(formData, "note") }).onConflictDoNothing();
  if ((res.rowsAffected ?? 0) > 0) await award({ workspaceId, userId }, "curriculum", lesson.points, `Lesson: ${lesson.name}`, `lesson:${lessonId}`);
  refresh();
}

export async function uncompleteLessonAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.lessonProgress).where(and(eq(schema.lessonProgress.userId, userId), eq(schema.lessonProgress.lessonId, str(formData, "lessonId"))));
  refresh();
}

/* ───────── Certification ───────── */

export async function submitCertAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  if (!v.membership.certEnabled && v.role !== "coach") return;
  const deliverableId = str(formData, "deliverableId");
  const d = await db.query.certDeliverables.findFirst({ where: eq(schema.certDeliverables.id, deliverableId) });
  if (!d) return;
  const url = opt(formData, "url");
  const notes = opt(formData, "notes");
  if (!url && !notes) return;
  const existing = await db.query.certSubmissions.findFirst({ where: and(eq(schema.certSubmissions.userId, userId), eq(schema.certSubmissions.deliverableId, deliverableId)) });
  if (existing && existing.status === "passed") return;
  if (existing) await db.update(schema.certSubmissions).set({ url, notes, status: "submitted", score: null, feedback: existing.feedback }).where(eq(schema.certSubmissions.id, existing.id));
  else await db.insert(schema.certSubmissions).values({ id: newId(), workspaceId, userId, deliverableId, url, notes, status: "submitted" });
  refresh();
}

/** Coach scores a submission. Pass or revise follows the deliverable's own threshold. */
export async function reviewCertAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const id = str(formData, "id");
  const s = await db.query.certSubmissions.findFirst({ where: and(eq(schema.certSubmissions.id, id), eq(schema.certSubmissions.workspaceId, coach.workspace.id)) });
  if (!s) return;
  const d = await db.query.certDeliverables.findFirst({ where: eq(schema.certDeliverables.id, s.deliverableId) });
  if (!d) return;
  const score = Math.max(0, Math.min(100, num(formData, "score")));
  const passed = score >= d.passThreshold;
  await db.update(schema.certSubmissions).set({ score, feedback: opt(formData, "feedback"), status: passed ? "passed" : "revise", reviewedBy: coach.user.id }).where(eq(schema.certSubmissions.id, id));
  if (passed) await award({ workspaceId: s.workspaceId, userId: s.userId }, "pathway", 100, `Certification: ${d.name}`, `cert:${d.id}`);
  refresh();
}

export async function setCertEnabledAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const enabled = str(formData, "enabled") === "1";
  await db.update(schema.memberships).set({ certEnabled: enabled }).where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, coach.workspace.id)));
  refresh();
}
