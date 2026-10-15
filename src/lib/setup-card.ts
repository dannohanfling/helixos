/**
 * The Setup card's data (H-270 §1): the step list from the setup_steps table (seeded from setup.json, the coach's to edit), the
 * member's facts gathered once from what HelixOS already holds, their ticks, and the coach's video slot. Every "done" is the
 * engine's reading of those facts; nothing here guesses.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { sectionFilled, type EssenceData } from "@/lib/engine/essence";
import { brandKitProblems } from "@/lib/engine/subject";
import { byPlace, SETUP_STEPS, setupSteps as evaluate, type SetupFacts, type SetupStep, type SetupStepDef } from "@/lib/engine/setup";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";

type Member = { workspaceId: string; userId: string };

/** The live step list: the table when seeded, else the file. */
export async function setupDefs(): Promise<SetupStepDef[]> {
  const rows = await db.query.setupSteps.findMany();
  if (!rows.length) return SETUP_STEPS;
  return rows.map((r) => ({ key: r.key, group: r.group, order: r.order, label: r.label, href: r.href, signal: r.signal, needs: r.needs ?? [], minutes: r.minutes })).sort(byPlace);
}

/** What HelixOS knows about one member, read once. */
export async function setupFactsFor(v: Viewer): Promise<SetupFacts> {
  const m: Member = { workspaceId: v.workspace.id, userId: v.user.id };
  const mine = <T extends { workspaceId: unknown; userId: unknown }>(t: T) => and(eq(t.workspaceId as never, m.workspaceId), eq(t.userId as never, m.userId));
  const [essence, goal, logo, kit, ai, ghl, botKey, approvals, team, apps, fathom, lockin, ticks] = await Promise.all([
    db.query.essences.findFirst({ where: mine(schema.essences), columns: { data: true } }),
    db.query.goals.findFirst({ where: and(mine(schema.goals), eq(schema.goals.primary, true)), columns: { id: true, target: true } }),
    db.query.deckImages.findFirst({ where: and(mine(schema.deckImages), eq(schema.deckImages.kind, "logo")), columns: { id: true } }),
    db.query.brandKits.findFirst({ where: mine(schema.brandKits) }),
    db.query.aiCredentials.findFirst({ where: mine(schema.aiCredentials), columns: { lastValidatedAt: true, lastError: true } }),
    db.query.socialConnections.findFirst({ where: mine(schema.socialConnections), columns: { connectedAt: true, lastError: true, accounts: true, mapping: true } }),
    db.query.botKeys.findFirst({ where: and(mine(schema.botKeys), isNull(schema.botKeys.revokedAt)), columns: { lastUsedAt: true } }),
    db.query.botApprovals.findFirst({ where: eq(schema.botApprovals.membershipId, v.membership.id), columns: { id: true } }),
    db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.ownerMembershipId, v.membership.id), columns: { id: true } }),
    db.query.connectedApps.findFirst({ where: and(mine(schema.connectedApps), isNull(schema.connectedApps.revokedAt), isNull(schema.connectedApps.agentId)), columns: { id: true } }),
    db.query.fathomConnections.findFirst({ where: mine(schema.fathomConnections), columns: { id: true } }),
    db.query.dailyLogs.findFirst({ where: mine(schema.dailyLogs), columns: { morningDoneAt: true } }),
    db.query.setupTicks.findMany({ where: mine(schema.setupTicks), columns: { stepKey: true, byCoach: true } }),
  ]);
  const data = (essence?.data ?? {}) as EssenceData;
  const has = (s: unknown) => typeof s === "string" && s.trim().length > 0;
  const ms = v.membership;
  return {
    signedIn: true,
    startHereWatched: Boolean(ms.startHereWatchedAt),
    profileSaved: Boolean(ms.profileSavedAt),
    photo: Boolean(ms.headshotUrl) && ms.headshotSource !== "removed",
    firstLockin: Boolean(lockin?.morningDoneAt),
    bigPromise: has(ms.bigPromise) && has(ms.audience),
    goal: Boolean(goal && goal.target > 0),
    essence: sectionFilled(data, "mission_and_vision") && sectionFilled(data, "goals_and_objectives") && sectionFilled(data, "representative_stories"),
    // A logo in Images, or the one the brand kit points at (the same reading as the webinar shot list).
    logo: Boolean(logo) || Boolean(kit?.logoImageId),
    brandKit: Boolean(kit) && brandKitProblems(kit!).length === 0,
    aiKey: Boolean(ai?.lastValidatedAt) && !ai?.lastError,
    council: (ms.boardCouncil ?? []).length >= 4,
    ghl: { connected: Boolean(ghl?.connectedAt) && !ghl?.lastError, pages: (ghl?.accounts ?? []).length > 0, mapped: Object.keys(ghl?.mapping ?? {}).length > 0 },
    bookingLink: has(ms.bookingUrl),
    bot: { connected: Boolean(botKey?.lastUsedAt), facts: has(ms.whatIDo) && Boolean(approvals) },
    team: Boolean(team),
    claude: Boolean(apps),
    fathom: Boolean(fathom),
    mfDomains: (ms.mfDomains ?? []).length > 0,
    assistant: Boolean(ms.chatProgressShare),
    humanos: Boolean(ms.bodyEnabled),
    ticks: ticks.map((t) => t.stepKey),
    coachTicks: ticks.filter((t) => t.byCoach).map((t) => t.stepKey),
  };
}

/** The member's steps, evaluated. */
export async function setupFor(v: Viewer): Promise<SetupStep[]> {
  const [defs, facts] = await Promise.all([setupDefs(), setupFactsFor(v)]);
  return evaluate(defs, facts);
}

/** Tick a step, or clear the tick. A coach's tick is marked as the coach's: the two coach steps count only those. */
export async function tickSetup(m: Member, stepKey: string, on: boolean, byUserId: string, byCoach: boolean): Promise<void> {
  const where = and(eq(schema.setupTicks.workspaceId, m.workspaceId), eq(schema.setupTicks.userId, m.userId), eq(schema.setupTicks.stepKey, stepKey));
  if (!on) {
    await db.delete(schema.setupTicks).where(where);
    return;
  }
  const had = await db.query.setupTicks.findFirst({ where, columns: { id: true } });
  if (had) await db.update(schema.setupTicks).set({ byUserId, byCoach }).where(where);
  else await db.insert(schema.setupTicks).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, stepKey, byUserId, byCoach });
}

/** The Start Here video played to the end (S1a), stamped once. */
export async function markStartHereWatched(membershipId: string): Promise<void> {
  await db.update(schema.memberships).set({ startHereWatchedAt: nowIso() }).where(and(eq(schema.memberships.id, membershipId), isNull(schema.memberships.startHereWatchedAt)));
}

/** The coach edits one step: label, group, order, link, what it reads, what it needs first, minutes. Keys never change. */
export async function saveSetupStep(row: SetupStepDef): Promise<void> {
  const defs = await setupDefs();
  if (!defs.some((d) => d.key === row.key)) throw new Error("That step isn't on the list.");
  const needs = row.needs.filter((k) => k !== row.key && defs.some((d) => d.key === k));
  const values = { group: row.group, order: row.order, label: row.label, href: row.href, signal: row.signal, needs, minutes: row.minutes, updatedAt: nowIso() };
  // The table is seeded by the seed; a workspace that has never reseeded gets the file's rows written now, with this edit.
  if (!(await db.query.setupSteps.findFirst({ columns: { key: true } }))) for (const d of SETUP_STEPS) await db.insert(schema.setupSteps).values(d).onConflictDoNothing();
  await db.update(schema.setupSteps).set(values).where(eq(schema.setupSteps.key, row.key));
}

/** The coach's video slot: a link, or nothing ("Coming soon"). */
export async function setStartHereVideo(workspaceId: string, url: string | null): Promise<void> {
  await db.update(schema.workspaces).set({ startHereVideo: url }).where(eq(schema.workspaces.id, workspaceId));
}
