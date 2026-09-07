"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { inviteCode } from "@/lib/ids";
import { totalPoints } from "@/lib/queries/points";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";

/** Any IANA zone the runtime knows; anything else is null, meaning "use the workspace's". */
function validTimezone(tz: string): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const name = str(formData, "name");
  const emoji = str(formData, "avatarEmoji");
  await db.update(schema.users).set({ ...(name ? { name } : {}), ...(emoji ? { avatarEmoji: emoji.slice(0, 4) } : {}) }).where(eq(schema.users.id, userId));
  await db
    .update(schema.memberships)
    .set({
      businessName: opt(formData, "businessName"),
      bigPromise: opt(formData, "bigPromise"),
      reminderHour: Math.min(23, Math.max(0, num(formData, "reminderHour") || 8)),
      eveningReminderHour: Math.min(23, Math.max(0, num(formData, "eveningReminderHour") || 17)),
      leaderboardOptIn: formData.get("leaderboardOptIn") === "on",
      timezone: validTimezone(str(formData, "timezone")),
    })
    .where(eq(schema.memberships.id, v.membership.id));
  refresh();
}

export async function updateGoalAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const title = str(formData, "title") || "Cash collected this month";
  const target = num(formData, "target") || 5000;
  const existing = await db.query.goals.findFirst({ where: and(eq(schema.goals.userId, userId), eq(schema.goals.primary, true)) });
  if (existing) {
    await db.update(schema.goals).set({ title, target, actual: num(formData, "actual"), unit: str(formData, "unit") || "$", period: str(formData, "period") || "This month" }).where(eq(schema.goals.id, existing.id));
  } else {
    await db.insert(schema.goals).values({ id: newId(), workspaceId, userId, title, target, actual: num(formData, "actual"), unit: str(formData, "unit") || "$", period: str(formData, "period") || "This month", primary: true });
  }
  refresh();
}

export async function updateWorkspaceAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  await db
    .update(schema.workspaces)
    .set({
      name: str(formData, "name") || coach.workspace.name,
      timezone: str(formData, "timezone") || coach.workspace.timezone,
      brandVoice: opt(formData, "brandVoice"),
      airtableBaseId: opt(formData, "airtableBaseId"),
    })
    .where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
}

export async function rotateInviteAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const which = str(formData, "which") === "coach" ? "coachInviteCode" : "clientInviteCode";
  await db.update(schema.workspaces).set({ [which]: inviteCode() }).where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
}

export async function claimRewardAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const name = str(formData, "name");
  const cost = num(formData, "cost");
  if (!name) return;
  const points = await totalPoints(workspaceId, userId);
  if (cost > 0 && points < cost) return;
  await db.insert(schema.rewardClaims).values({ id: newId(), workspaceId, userId, rewardName: name, pointsSpent: cost });
  if (cost > 0) {
    await db.insert(schema.pointsLedger).values({ id: newId(), workspaceId, userId, type: "redeem", points: -cost, reason: `Claimed: ${name}` });
  }
  refresh();
}
