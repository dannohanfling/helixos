"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { feedbackMonth, readFeedback } from "@/lib/engine/feedback";

/**
 * End-of-month feedback, sent or changed (handoff rev 124). The month is the one the window is asking about, from the session's own
 * date, never the form; outside the window (the last 3 days of a month to the 5th of the next) nothing is saved. One per member per
 * month: sending again inside the window changes it.
 */
export async function saveFeedbackAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const month = feedbackMonth(v.today);
  if (!month) redirect("/today");
  const read = readFeedback({
    proud: str(formData, "proud"),
    love: str(formData, "love"),
    less: str(formData, "less"),
    more: str(formData, "more"),
    wow: str(formData, "wow"),
    referralScore: str(formData, "referralScore"),
    referral: str(formData, "referral"),
    favorite: str(formData, "favorite"),
  });
  if ("error" in read) redirect(`/today?feedbackError=${encodeURIComponent(read.error)}#feedback`);
  const f = read.value;
  const row = { proud: f.proud, love: f.love, less: f.less, more: f.more, wow: f.wow, referralScore: f.referralScore, referral: f.referral || null, favorite: f.favorite || null };
  const existing = await db.query.monthlyFeedback.findFirst({ where: and(eq(schema.monthlyFeedback.workspaceId, workspaceId), eq(schema.monthlyFeedback.userId, userId), eq(schema.monthlyFeedback.month, month)) });
  if (existing) {
    await db
      .update(schema.monthlyFeedback)
      .set({ ...row, updatedAt: nowIso() })
      .where(and(eq(schema.monthlyFeedback.id, existing.id), eq(schema.monthlyFeedback.userId, userId), eq(schema.monthlyFeedback.workspaceId, workspaceId)));
  } else {
    await db.insert(schema.monthlyFeedback).values({ id: newId(), workspaceId, userId, month, ...row }).onConflictDoNothing();
  }
  refresh();
  redirect("/today?feedbackSaved=1#feedback");
}
