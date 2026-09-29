"use server";

import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import type { IntentionKeyResult, IntentionTask } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { hitTarget, readIntention, soundsLikeTask, targetOf, tasksDueOn, weekOf } from "@/lib/engine/intentions";
import { monthOf, readMonthIntention } from "@/lib/engine/month-intentions";
import { SHARE_POINTS, shareRef } from "@/lib/engine/community";
import { shareFor } from "@/lib/community";
import { award } from "@/lib/queries/points";

/** Where a form goes back to: the Intentions page or Today, and nothing else. */
const backTo = (formData: FormData): "/intentions" | "/today" => (str(formData, "back") === "/intentions" ? "/intentions" : "/today");

/**
 * Set or edit this week's 3-1-3 (handoff rev 124). The week is always the member's current one, from the session's own date,
 * never from the form. The tasks become the week's Tasks, due Friday (or the day set, on a weekend): an edit renames each open one in its slot, adds a new one,
 * and removes one the member has taken off unless it is already done; a done task stays done.
 */
export async function saveIntentionAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "That's in {first}'s own words, so it's theirs to write." });
  const week = weekOf(v.today);
  const read = readIntention({
    word: str(formData, "word"),
    kr: [str(formData, "kr1"), str(formData, "kr2"), str(formData, "kr3")],
    initiative: str(formData, "initiative"),
    tasks: [str(formData, "task1"), str(formData, "task2"), str(formData, "task3")],
  });
  if ("error" in read) redirect(`${backTo(formData)}?weekError=${encodeURIComponent(read.error)}${read.field ? `&field=${read.field}` : ""}#week`);
  const { value } = read;
  const existing = await db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, workspaceId), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.weekOf, week)) });
  const before = existing?.tasks ?? [];
  const tasks: IntentionTask[] = [];
  for (const [i, title] of value.tasks.entries()) {
    const prior = before[i]?.taskId;
    if (prior) {
      await db.update(schema.tasks).set({ title }).where(and(eq(schema.tasks.id, prior), eq(schema.tasks.userId, userId), eq(schema.tasks.workspaceId, workspaceId)));
      tasks.push({ title, taskId: prior });
    } else {
      const id = newId();
      await db.insert(schema.tasks).values({ id, workspaceId, userId, title, status: "upcoming", urgency: "high", dueDate: tasksDueOn(v.today), source: "intention", sourceRef: week });
      tasks.push({ title, taskId: id });
    }
  }
  for (const gone of before.slice(value.tasks.length)) {
    if (gone.taskId) await db.delete(schema.tasks).where(and(eq(schema.tasks.id, gone.taskId), eq(schema.tasks.userId, userId), eq(schema.tasks.workspaceId, workspaceId), ne(schema.tasks.status, "done")));
  }
  // A key result keeps its mark only while its words are unchanged.
  // One saved as written though it reads like a task is marked for the coach (rev 158: the nudge asks, it never blocks).
  const keyResults = value.keyResults.map((text, i) => {
    const same = existing?.keyResults[i]?.text === text ? existing.keyResults[i] : null;
    return { text, done: same ? same.done : null, actual: same?.actual ?? null, ...(soundsLikeTask(text) ? { kept: true } : {}) };
  });
  if (existing) {
    await db
      .update(schema.weeklyIntentions)
      .set({ word: value.word, keyResults, initiative: value.initiative, tasks, updatedAt: nowIso() })
      .where(and(eq(schema.weeklyIntentions.id, existing.id), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.workspaceId, workspaceId)));
  } else {
    await db.insert(schema.weeklyIntentions).values({ id: newId(), workspaceId, userId, weekOf: week, word: value.word, keyResults, initiative: value.initiative, tasks }).onConflictDoNothing();
  }
  refresh();
  redirect(`${backTo(formData)}?weekSaved=1#week`);
}

/** The end-of-week check: each key result done or not done, all at once. Only this week's, and only once it is set. */
export async function reviewIntentionAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "That's in {first}'s own words, so it's theirs to write." });
  const week = weekOf(v.today);
  const existing = await db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, workspaceId), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.weekOf, week)) });
  if (!existing) redirect(`${backTo(formData)}#week`);
  // Against the number set (rev 158): "how many did you get?", and done means they hit it. A key result with no number (set
  // before the rule) is still marked done or not done.
  const keyResults: IntentionKeyResult[] = [];
  for (const [i, k] of existing.keyResults.entries()) {
    if (targetOf(k.text) !== null) {
      const raw = str(formData, `kr${i + 1}Count`).trim();
      if (!/^\d+(\.\d+)?$/.test(raw)) redirect(`${backTo(formData)}?weekError=${encodeURIComponent("Write how many you got for each key result, like 2.")}#week`);
      const actual = Number(raw);
      keyResults.push({ ...k, actual, done: hitTarget(k.text, actual) });
    } else {
      const mark = str(formData, `kr${i + 1}`);
      if (mark !== "done" && mark !== "not") redirect(`${backTo(formData)}?weekError=${encodeURIComponent("Mark each key result done or not done.")}#week`);
      keyResults.push({ ...k, done: mark === "done" });
    }
  }
  await db
    .update(schema.weeklyIntentions)
    .set({ keyResults, reviewedAt: nowIso(), updatedAt: nowIso() })
    .where(and(eq(schema.weeklyIntentions.id, existing.id), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.workspaceId, workspaceId)));
  refresh();
  redirect(`${backTo(formData)}?weekReviewed=1#week`);
}

/**
 * Set or edit this month's intention (handoff rev 129): the eleven questions, all required. The month is always the member's
 * current one, from the session's own date, never from the form. The revenue goal is theirs and their coach's, never another
 * member's.
 */
export async function saveMonthIntentionAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "That's in {first}'s own words, so it's theirs to write." });
  const month = monthOf(v.today);
  const read = readMonthIntention({
    word: str(formData, "word"),
    personalSeason: str(formData, "personalSeason"),
    fear: str(formData, "fear"),
    habit: str(formData, "habit"),
    skill: str(formData, "skill"),
    impact: str(formData, "impact"),
    businessSeason: str(formData, "businessSeason"),
    revenueGoal: str(formData, "revenueGoal"),
    revenueWhy: str(formData, "revenueWhy"),
    plan: str(formData, "plan"),
    proudLast: str(formData, "proudLast"),
    proudEnd: str(formData, "proudEnd"),
  });
  if ("error" in read) redirect(`${backTo(formData)}?monthError=${encodeURIComponent(read.error)}${read.field ? `&field=${read.field}` : ""}#month`);
  const existing = await db.query.monthlyIntentions.findFirst({ where: and(eq(schema.monthlyIntentions.workspaceId, workspaceId), eq(schema.monthlyIntentions.userId, userId), eq(schema.monthlyIntentions.month, month)) });
  if (existing) {
    await db
      .update(schema.monthlyIntentions)
      .set({ ...read.value, updatedAt: nowIso() })
      .where(and(eq(schema.monthlyIntentions.id, existing.id), eq(schema.monthlyIntentions.userId, userId), eq(schema.monthlyIntentions.workspaceId, workspaceId)));
  } else {
    await db.insert(schema.monthlyIntentions).values({ id: newId(), workspaceId, userId, month, ...read.value }).onConflictDoNothing();
  }
  refresh();
  redirect(`${backTo(formData)}?monthSaved=1#month`);
}

/**
 * The tap on "Share to the thread" (piece 2): recorded once per week, with the week's points on the first tap (the coach can
 * take them back). Only for the member's own current week, and only once this week's post is out: nothing is recorded for a
 * post that doesn't exist. The comment itself is posted by the member, under their own name; HelixOS never posts it.
 */
export async function recordShareAction(): Promise<{ ok: boolean; points: number; error?: string }> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "Nothing is sent or published as {first} from their HelixOS. They can do it themselves." });
  const week = await db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, workspaceId), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.weekOf, weekOf(v.today))) });
  if (!week) return { ok: false, points: 0, error: "Set your 3-1-3 first." };
  const share = await shareFor(workspaceId, userId, week);
  if (!share.link) return { ok: false, points: 0, error: share.reason ?? "This week's post isn't up yet." };
  await db.insert(schema.communityShares).values({ id: newId(), workspaceId, userId, weekOf: week.weekOf }).onConflictDoNothing();
  const scored = await award({ workspaceId, userId }, "community", SHARE_POINTS, "Shared your 3-1-3 in the community", shareRef(week.weekOf));
  return { ok: true, points: scored ? SHARE_POINTS : 0 };
}
