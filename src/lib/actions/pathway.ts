"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { award } from "@/lib/queries/points";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";

export async function submitPathwayTaskAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const key = str(formData, "key");
  const lib = await db.query.libraryTasks.findFirst({ where: eq(schema.libraryTasks.key, key) });
  if (!lib) return;
  const existing = await db.query.pathwayProgress.findFirst({
    where: and(eq(schema.pathwayProgress.userId, userId), eq(schema.pathwayProgress.libraryTaskKey, key)),
  });
  const submissionUrl = opt(formData, "submissionUrl");
  const submissionText = opt(formData, "submissionText");
  const selfVerify = lib.submissionType === "checkbox";
  const patch = {
    status: selfVerify ? ("verified" as const) : ("submitted" as const),
    submissionUrl,
    submissionText,
    submittedAt: nowIso(),
    verifiedAt: selfVerify ? nowIso() : null,
    verifiedBy: selfVerify ? "self" : null,
  };
  if (existing) await db.update(schema.pathwayProgress).set(patch).where(eq(schema.pathwayProgress.id, existing.id));
  else await db.insert(schema.pathwayProgress).values({ id: newId(), workspaceId, userId, libraryTaskKey: key, ...patch });
  if (selfVerify) await award({ workspaceId, userId }, "pathway", lib.points, `Pathway: ${lib.name}`, key);
  refresh();
}

export async function reviewPathwayTaskAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const id = str(formData, "id");
  const decision = str(formData, "decision") === "verify" ? "verified" : "revision";
  const feedback = opt(formData, "feedback");
  const row = await db.query.pathwayProgress.findFirst({ where: and(eq(schema.pathwayProgress.id, id), eq(schema.pathwayProgress.workspaceId, coach.workspace.id)) });
  if (!row) return;
  await db
    .update(schema.pathwayProgress)
    .set({
      status: decision,
      coachFeedback: feedback,
      verifiedAt: decision === "verified" ? nowIso() : null,
      verifiedBy: decision === "verified" ? coach.user.id : null,
    })
    .where(eq(schema.pathwayProgress.id, id));
  if (decision === "verified") {
    const lib = await db.query.libraryTasks.findFirst({ where: eq(schema.libraryTasks.key, row.libraryTaskKey) });
    if (lib) await award({ workspaceId: row.workspaceId, userId: row.userId }, "pathway", lib.points, `Pathway: ${lib.name}`, lib.key);
  }
  refresh();
}

export async function completeCurriculumDayAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const day = Number(str(formData, "day"));
  const item = await db.query.curriculumDays.findFirst({ where: eq(schema.curriculumDays.day, day) });
  if (!item) return;
  const res = await db.insert(schema.curriculumProgress).values({ id: newId(), workspaceId, userId, day, note: opt(formData, "note") }).onConflictDoNothing();
  if ((res.rowsAffected ?? 0) > 0) await award({ workspaceId, userId }, "curriculum", item.points, `Day ${day}: ${item.title}`, `day:${day}`);
  refresh();
}
