"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { feedbackMonthsOpen, readFeedback } from "@/lib/engine/feedback";

/**
 * End-of-month feedback, sent or changed (handoff rev 124; all month on Intentions since 9 Oct). The form names its month, and it
 * is saved only when the session's own date still allows that month: this month until it ends, last month through the 7th. One
 * per member per month: sending again changes it.
 */
export async function saveFeedbackAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "That's in {first}'s own words, so it's theirs to write." });
  const month = str(formData, "month");
  if (!feedbackMonthsOpen(v.today).includes(month)) redirect(`/intentions?feedbackError=${encodeURIComponent("That month's feedback is closed now. This month's is open below.")}#feedback`);
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
  if ("error" in read) redirect(`/intentions?feedbackError=${encodeURIComponent(read.error)}&feedbackMonth=${month}${read.field ? `&field=${read.field}` : ""}#feedback-${month}`);
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
  redirect(`/intentions?feedbackSaved=${month}#feedback-${month}`);
}
