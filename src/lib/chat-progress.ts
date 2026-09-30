/**
 * Progress pushes to the coach's Community Loyalty bot (rev 241, and rev 247's five helixos_* fields): when a member sets
 * their 3-1-3, a pathway step is verified, their goal or main offer changes, or they sign in for the first time, HelixOS
 * posts a short snapshot so the assistant knows where they are. The member's own switch ("Let my coach's assistant know my
 * progress", on by default) governs it; one push per member per hour; at most the platform's 500 a day per workspace.
 * Never Body, keys, tokens or notes: the payload is built from named fields only (src/lib/engine/chat.ts).
 */
import { and, asc, count, desc, eq, gte, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { background, logSync } from "@/lib/integrations";
import { pathwayRoad } from "@/lib/queries/today";
import { chatConfig, postChatWebhook } from "@/lib/chat";
import { DAILY_CAP, goalLine, mainOfferName, progressPayload, week313Line, withinPushGap, type ProgressReason } from "@/lib/engine/chat";

/** Chat posts sent today (UTC), against the platform's daily limit. */
export async function sentToday(workspaceId: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const [row] = await db.select({ n: count() }).from(schema.syncEvents).where(and(eq(schema.syncEvents.workspaceId, workspaceId), eq(schema.syncEvents.provider, "community_loyalty"), eq(schema.syncEvents.direction, "out"), like(schema.syncEvents.event, "chat.%"), eq(schema.syncEvents.status, "sent"), gte(schema.syncEvents.createdAt, `${day} 00:00:00`)));
  return row?.n ?? 0;
}

/** What the bot is told: the road line, the goal, this week's 3-1-3 and the main offer, each in one line or empty. */
export async function progressSnapshot(workspaceId: string, userId: string) {
  const [user, road, goal, week, offers] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
    pathwayRoad(userId),
    db.query.goals.findFirst({ where: and(eq(schema.goals.workspaceId, workspaceId), eq(schema.goals.userId, userId), eq(schema.goals.primary, true)) }),
    db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, workspaceId), eq(schema.weeklyIntentions.userId, userId)), orderBy: desc(schema.weeklyIntentions.weekOf) }),
    db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, workspaceId), eq(schema.offers.userId, userId)), orderBy: asc(schema.offers.createdAt) }),
  ]);
  if (!user) return null;
  return { email: user.email, name: user.name, pathwayStage: road || null, goal: goalLine(goal ?? null), week313: week313Line(week ?? null), mainOffer: mainOfferName(offers) };
}

export type PushOutcome = "sent" | "failed" | "off" | "not_set_up" | "debounced" | "capped" | "no_member";

/** One push, now. Says why when nothing went out; the sync log has the sent and failed ones. */
export async function pushProgress(workspaceId: string, userId: string, reason: ProgressReason): Promise<PushOutcome> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)) });
  if (!m || m.removedAt) return "no_member";
  if (!m.chatProgressShare) return "off";
  const c = await chatConfig(workspaceId);
  if (!c.webhookUrl) return "not_set_up";
  if (withinPushGap(m.lastChatPushAt, Date.now())) return "debounced";
  if ((await sentToday(workspaceId)) >= DAILY_CAP) {
    await logSync({ workspaceId, userId, provider: "community_loyalty", direction: "out", event: "chat.progress", payload: { reason }, status: "skipped", note: `The bot's daily limit of ${DAILY_CAP} posts is reached; this one waits for tomorrow.` });
    return "capped";
  }
  const snap = await progressSnapshot(workspaceId, userId);
  if (!snap) return "no_member";
  const res = await postChatWebhook(workspaceId, userId, progressPayload({ ...snap, reason, at: nowIso() }));
  if (!res.ok) return "failed";
  await db.update(schema.memberships).set({ lastChatPushAt: nowIso() }).where(eq(schema.memberships.id, m.id));
  return "sent";
}

/** The hook the actions call: the push runs after the response, and never fails the action. */
export function queueProgress(workspaceId: string, userId: string, reason: ProgressReason): void {
  background(pushProgress(workspaceId, userId, reason));
}
