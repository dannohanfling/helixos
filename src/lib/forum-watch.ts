/**
 * The stall watch (H-495), the database side. `watchForum` flags an agent that has stopped checking in (once per stall: the
 * card's Paused line, one What needs you item, a log line, and the owner's email when they turned it on) and clears one that
 * is back; `heardFrom` clears a stall the moment the agent reports, calls or checks in. The cron runs `watchAllForums` every
 * five minutes, and the Forum page runs `watchForum` when it opens. Logs carry counts and times only.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { appUrl } from "@/lib/branded-email";
import { formatDateTime, nowIso } from "@/lib/dates";
import { sendEmail } from "@/lib/email";
import { canEmail } from "@/lib/email-gate";
import { liveStatus } from "@/lib/engine/forum";
import { latestStamp, stallFor, stallWords, watched } from "@/lib/engine/forum-watch";
import { newId } from "@/lib/ids";

type Owner = { workspaceId: string; userId: string };

/** The owner's zone: their own, else their workspace's (H-457). */
async function ownerZone(o: Owner): Promise<{ tz: string; membershipId: string | null }> {
  const [m, w] = await Promise.all([
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, o.workspaceId), eq(schema.memberships.userId, o.userId)), columns: { id: true, timezone: true } }),
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, o.workspaceId), columns: { timezone: true } }),
  ]);
  return { tz: m?.timezone || w?.timezone || "America/Los_Angeles", membershipId: m?.id ?? null };
}

/** End a stall: the Paused line goes, its What needs you item is ticked by the agent, and the log says when it came back. */
async function clearStall(o: Owner, agent: { id: string; stallNeedId: string | null }, at: string, tz: string, logBack: boolean): Promise<boolean> {
  const done = await db
    .update(schema.forumAgents)
    .set({ stalledAt: null, stallSince: null, stallNeedId: null })
    .where(and(eq(schema.forumAgents.id, agent.id), isNotNull(schema.forumAgents.stalledAt)))
    .returning({ id: schema.forumAgents.id });
  if (!done.length) return false;
  if (agent.stallNeedId) await db.update(schema.forumNeeds).set({ doneAt: nowIso(), doneBy: "agent" }).where(and(eq(schema.forumNeeds.id, agent.stallNeedId), isNull(schema.forumNeeds.doneAt)));
  if (logBack) await db.insert(schema.forumEvents).values({ id: newId(), ...o, agentId: agent.id, kind: "status", source: "watch", payload: { stall: "back", now: stallWords.back(formatDateTime(at, tz, { zone: true })) }, at });
  return true;
}

/** The agent was just heard from (a report, a call through its connection, a check-in): any stall it was in ends now. */
export async function heardFrom(o: Owner, agent: { id: string; stalledAt?: string | null; stallNeedId?: string | null }): Promise<void> {
  const row = agent.stalledAt === undefined ? await db.query.forumAgents.findFirst({ where: eq(schema.forumAgents.id, agent.id), columns: { stalledAt: true, stallNeedId: true } }) : agent;
  if (!row?.stalledAt) return;
  const { tz } = await ownerZone(o);
  await clearStall(o, { id: agent.id, stallNeedId: row.stallNeedId ?? null }, nowIso(), tz, true);
}

/** One owner's Forum: flag who has stopped, clear who is back or no longer watched. Returns the counts. */
export async function watchForum(o: Owner, now: Date = new Date()): Promise<{ flagged: number; cleared: number }> {
  const [agents, tokens, checkins, settings] = await Promise.all([
    db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId)) }),
    db.query.agentTokens.findMany({ where: and(eq(schema.agentTokens.workspaceId, o.workspaceId), eq(schema.agentTokens.userId, o.userId), isNull(schema.agentTokens.revokedAt)), columns: { agentId: true } }),
    db.query.handoffAgents.findMany({ where: and(eq(schema.handoffAgents.workspaceId, o.workspaceId), eq(schema.handoffAgents.userId, o.userId)) }),
    db.query.forumSettings.findFirst({ where: and(eq(schema.forumSettings.workspaceId, o.workspaceId), eq(schema.forumSettings.userId, o.userId)), columns: { checkinsPaused: true, stallEmails: true } }),
  ]);
  const withToken = new Set(tokens.map((t) => t.agentId));
  const zone = await ownerZone(o);
  let flagged = 0;
  let cleared = 0;
  for (const a of agents) {
    const c = checkins.find((x) => x.agentId === a.id) ?? null;
    const heardAt = latestStamp([a.reportedAt, a.lastCallAt, c?.lastCheckinAt]);
    const input = {
      builtIn: Boolean(a.builtIn),
      hasToken: withToken.has(a.id),
      muted: a.stallMuted,
      status: liveStatus(a, now),
      heardAt,
      checkins: c ? { on: c.checkins, everyMinutes: c.everyMinutes, from: c.activeFrom, to: c.activeTo, days: c.activeDays, tz: c.tz } : null,
      paused: Boolean(settings?.checkinsPaused),
    };
    if (a.stalledAt) {
      // Back since it was flagged (a path that didn't clear it inline), or no longer watched: the stall ends.
      const back = heardAt !== null && heardAt > (latestStamp([a.stallSince]) ?? "");
      if (back || !watched(input)) if (await clearStall(o, a, back ? heardAt! : now.toISOString(), zone.tz, back)) cleared++;
      continue;
    }
    if (!stallFor(input, now)) continue;
    const since = heardAt!;
    const time = formatDateTime(since, zone.tz, { zone: true });
    // Claimed once: a second watcher run (the cron and a page open together) finds stalledAt set and stops here.
    const claimed = await db
      .update(schema.forumAgents)
      .set({ stalledAt: now.toISOString(), stallSince: since })
      .where(and(eq(schema.forumAgents.id, a.id), isNull(schema.forumAgents.stalledAt)))
      .returning({ id: schema.forumAgents.id });
    if (!claimed.length) continue;
    const needId = newId();
    await db.insert(schema.forumNeeds).values({ id: needId, ...o, agentId: a.id, what: stallWords.need(a.name, time) });
    await db.update(schema.forumAgents).set({ stallNeedId: needId }).where(eq(schema.forumAgents.id, a.id));
    await db.insert(schema.forumEvents).values({ id: newId(), ...o, agentId: a.id, kind: "status", source: "watch", payload: { stall: "stopped", now: stallWords.stopped(time) }, at: now.toISOString() });
    flagged++;
    if (settings?.stallEmails && zone.membershipId && (await canEmail(zone.membershipId))) {
      const u = await db.query.users.findFirst({ where: eq(schema.users.id, o.userId), columns: { email: true } });
      if (u) await sendEmail(u.email, stallWords.emailSubject(a.name), `${stallWords.need(a.name, time)}\n\n${stallWords.card(time)}\n\nThe Forum: ${appUrl()}/forum\n\nTurn these emails off on Coach → Inbox.`);
    }
  }
  return { flagged, cleared };
}

/** Every Forum with an agent that has its own token, or a stall to clear. For the cron. */
export async function watchAllForums(now: Date = new Date()): Promise<{ forums: number; flagged: number; cleared: number }> {
  const [live, stalled] = await Promise.all([
    db.selectDistinct({ workspaceId: schema.agentTokens.workspaceId, userId: schema.agentTokens.userId }).from(schema.agentTokens).where(isNull(schema.agentTokens.revokedAt)),
    db.selectDistinct({ workspaceId: schema.forumAgents.workspaceId, userId: schema.forumAgents.userId }).from(schema.forumAgents).where(isNotNull(schema.forumAgents.stalledAt)),
  ]);
  const owners = new Map([...live, ...stalled].map((o) => [`${o.workspaceId}:${o.userId}`, o]));
  let flagged = 0;
  let cleared = 0;
  for (const o of owners.values()) {
    const r = await watchForum(o, now);
    flagged += r.flagged;
    cleared += r.cleared;
  }
  return { forums: owners.size, flagged, cleared };
}

/** The owner's stalled agents, for Today's notice: name and when it went quiet. */
export async function stalledAgentsOf(o: Owner): Promise<{ id: string; name: string; since: string }[]> {
  const rows = await db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), isNotNull(schema.forumAgents.stalledAt)), columns: { id: true, name: true, stallSince: true, stalledAt: true } });
  return rows.map((r) => ({ id: r.id, name: r.name, since: r.stallSince ?? r.stalledAt! }));
}

