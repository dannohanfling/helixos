/**
 * Bot Features on the server (rev 618 answers): the workspace's rules, what HelixOS sees of a member's milestones (plus the
 * coach's toggles), and each feature's state for that member. Nothing here writes to Community Loyalty: switching a feature on
 * stays the coach's manual step in the client's bot, and HelixOS only records that it's on. Bot Features never spend points.
 */
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { BOT_FEATURES, DEFAULT_RULES, featureState, ruleOf, unlockState, type Behavior, type BotFeature, type BotFeatureKey, type FeatureState, type UnlockRule } from "@/lib/engine/bot-features";
import { TIERS } from "@/lib/engine/tiers";
import { totalPoints } from "@/lib/queries/points";

export async function rulesFor(workspaceId: string): Promise<Record<BotFeatureKey, UnlockRule>> {
  const rows = await db.query.botFeatureRules.findMany({ where: eq(schema.botFeatureRules.workspaceId, workspaceId) });
  const out = { ...DEFAULT_RULES };
  for (const r of rows) out[r.featureKey] = { type: r.type, value: r.value };
  return out;
}

const tierMin = (name: string): number | null => TIERS.find((t) => t.name === name)?.minPoints ?? null;
const one = async (q: Promise<unknown[]>) => (await q).length > 0;

/** The milestones HelixOS can see for this member, and the ones the coach toggled on their row. A toggle always counts. */
export async function behaviorsOf(workspaceId: string, userId: string, toggled: Behavior[]): Promise<Set<Behavior>> {
  const [guide, event, client, proof, ladder, shipped] = await Promise.all([
    one(db.select({ id: schema.leadMagnets.id }).from(schema.leadMagnets).where(and(eq(schema.leadMagnets.workspaceId, workspaceId), eq(schema.leadMagnets.userId, userId), isNotNull(schema.leadMagnets.publishedAt))).limit(1)),
    one(db.select({ id: schema.webinars.id }).from(schema.webinars).where(and(eq(schema.webinars.workspaceId, workspaceId), eq(schema.webinars.userId, userId), eq(schema.webinars.isExample, false), isNotNull(schema.webinars.scheduledAt))).limit(1)),
    one(db.select({ id: schema.dailyLogs.id }).from(schema.dailyLogs).where(and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), gt(schema.dailyLogs.cashCollected, 0))).limit(1)),
    one(db.select({ id: schema.proofs.id }).from(schema.proofs).where(and(eq(schema.proofs.workspaceId, workspaceId), eq(schema.proofs.userId, userId))).limit(1)),
    one(db.select({ id: schema.ladders.id }).from(schema.ladders).where(and(eq(schema.ladders.workspaceId, workspaceId), eq(schema.ladders.userId, userId), inArray(schema.ladders.status, ["live", "done"]))).limit(1)),
    one(db.select({ id: schema.dripHandoffs.id }).from(schema.dripHandoffs).where(and(eq(schema.dripHandoffs.workspaceId, workspaceId), eq(schema.dripHandoffs.userId, userId))).limit(1)),
  ]);
  const seen = new Set<Behavior>(toggled);
  if (guide) seen.add("guide_link");
  if (event) seen.add("event_scheduled");
  if (client) seen.add("first_client");
  if (proof) seen.add("first_testimonial");
  if (ladder || shipped) seen.add("first_ladder_post");
  return seen;
}

export type FeatureView = { feature: BotFeature; state: FeatureState; unlockLine: string; progress: number | null; request: schema.BotFeatureRequest | null };

/** Every feature for one member, in Danno's order, with its state, the locked line and any progress bar (a tier or points rule). */
export async function featuresFor(m: Pick<schema.Membership, "workspaceId" | "userId" | "botUnlocks">): Promise<FeatureView[]> {
  const [rules, behaviors, points, requests] = await Promise.all([
    rulesFor(m.workspaceId),
    behaviorsOf(m.workspaceId, m.userId, m.botUnlocks ?? []),
    totalPoints(m.workspaceId, m.userId),
    db.query.botFeatureRequests.findMany({ where: and(eq(schema.botFeatureRequests.workspaceId, m.workspaceId), eq(schema.botFeatureRequests.userId, m.userId)) }),
  ]);
  const facts = { behaviors, points, tierName: "", tierMin };
  return BOT_FEATURES.map((feature) => {
    const u = unlockState(ruleOf(rules, feature.key), facts);
    const request = requests.find((r) => r.featureKey === feature.key) ?? null;
    return { feature, state: featureState(feature, u.unlocked, request), unlockLine: u.line, progress: u.unlocked ? null : u.progress, request };
  });
}

/** Unlocked, requested or on: what "N of 8 unlocked" counts. A Coming soon feature never counts. */
export const unlockedCount = (views: FeatureView[]) => views.filter((v) => v.state === "unlocked" || v.state === "requested" || v.state === "on").length;

/** Requests waiting for the coach to switch on: counted with open claims on the Coach item, and on the coach's Today. */
export async function waitingFeatures(workspaceId: string): Promise<number> {
  return (await db.select({ id: schema.botFeatureRequests.id }).from(schema.botFeatureRequests).where(and(eq(schema.botFeatureRequests.workspaceId, workspaceId), eq(schema.botFeatureRequests.state, "requested")))).length;
}

/** The client's Today line (rev 618): features switched on in the last seven days, newest first. */
export async function recentlyOn(workspaceId: string, userId: string, days = 7): Promise<{ key: BotFeatureKey; name: string }[]> {
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await db.query.botFeatureRequests.findMany({ where: and(eq(schema.botFeatureRequests.workspaceId, workspaceId), eq(schema.botFeatureRequests.userId, userId), eq(schema.botFeatureRequests.state, "on"), gt(schema.botFeatureRequests.onAt, sinceIso)) });
  return rows.sort((a, b) => (b.onAt ?? "").localeCompare(a.onAt ?? "")).map((r) => ({ key: r.featureKey, name: BOT_FEATURES.find((f) => f.key === r.featureKey)?.name ?? r.featureKey }));
}
