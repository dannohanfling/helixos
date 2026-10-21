/**
 * An agent in a client's HelixOS (H-1385, plan H-1389), the data side: the coach's grants per client and per agent, the
 * switch on an agent token's connection, the switched viewer (built like the coach's own Switch to client, rev 216), and the
 * client's record of what the agent did. Nothing here is reachable from the consent screen: a grant comes only from the
 * coach's client page, and the switch only from the agent's own token.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { hourInTz, nowIso, todayInTz } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { changeWords } from "@/lib/engine/agent-clients";

export type Owner = { workspaceId: string; userId: string };

export async function grantsForClient(o: Owner, clientMembershipId: string) {
  return db.query.agentClientGrants.findMany({ where: and(eq(schema.agentClientGrants.workspaceId, o.workspaceId), eq(schema.agentClientGrants.coachUserId, o.userId), eq(schema.agentClientGrants.clientMembershipId, clientMembershipId)), orderBy: [desc(schema.agentClientGrants.grantedAt)] });
}

/** The live grant of one agent for one client, or null. */
export async function liveGrant(o: Owner, agentId: string, clientMembershipId: string) {
  return (await db.query.agentClientGrants.findFirst({ where: and(eq(schema.agentClientGrants.workspaceId, o.workspaceId), eq(schema.agentClientGrants.coachUserId, o.userId), eq(schema.agentClientGrants.agentId, agentId), eq(schema.agentClientGrants.clientMembershipId, clientMembershipId), isNull(schema.agentClientGrants.revokedAt)) })) ?? null;
}

/** The clients an agent may work in now. */
export async function liveGrantsOf(o: Owner, agentId: string) {
  return db.query.agentClientGrants.findMany({ where: and(eq(schema.agentClientGrants.workspaceId, o.workspaceId), eq(schema.agentClientGrants.coachUserId, o.userId), eq(schema.agentClientGrants.agentId, agentId), isNull(schema.agentClientGrants.revokedAt)) });
}

/**
 * Allow or Stop, by the coach on the client's page. Allow with a live grant changes nothing; Stop revokes every live grant
 * of that agent for that client and ends the agent's switch on its next call. Both are recorded: the row itself and the
 * client's own record.
 */
export async function setGrant(o: Owner, agentId: string, clientMembershipId: string, on: boolean): Promise<boolean> {
  const client = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, clientMembershipId), eq(schema.memberships.workspaceId, o.workspaceId), eq(schema.memberships.role, "client")) });
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), eq(schema.forumAgents.id, agentId)) });
  if (!client || client.removedAt || !agent || agent.builtIn) return false;
  const live = await liveGrant(o, agentId, clientMembershipId);
  if (on && live) return true;
  const now = nowIso();
  if (on) {
    await db.insert(schema.agentClientGrants).values({ id: newId(), workspaceId: o.workspaceId, coachUserId: o.userId, agentId, clientMembershipId });
  } else {
    if (!live) return true;
    await db.update(schema.agentClientGrants).set({ revokedAt: now }).where(and(eq(schema.agentClientGrants.agentId, agentId), eq(schema.agentClientGrants.clientMembershipId, clientMembershipId), isNull(schema.agentClientGrants.revokedAt)));
    // The agent's token leaves the client's HelixOS at once; its next call is refused.
    const tokens = await db.query.agentTokens.findMany({ where: and(eq(schema.agentTokens.agentId, agentId), isNull(schema.agentTokens.revokedAt)), columns: { appId: true } });
    if (tokens.length) await db.update(schema.connectedApps).set({ switchedMembershipId: null }).where(and(inArray(schema.connectedApps.id, tokens.map((t) => t.appId)), eq(schema.connectedApps.switchedMembershipId, clientMembershipId)));
  }
  await db.insert(schema.coachChanges).values({ id: newId(), workspaceId: o.workspaceId, clientMembershipId, userId: client.userId, coachUserId: o.userId, agentId, kind: "change", mode: "work", action: on ? `Allowed ${agent.name} to work here` : `Stopped ${agent.name} working here`, page: "Settings", item: null });
  return true;
}

/** A client of the coach's by membership id or first name (one match), for client_switch. */
export async function clientByRef(o: Owner, ref: string): Promise<{ membership: schema.Membership; user: schema.User } | null> {
  const w = ref.trim();
  if (!w) return null;
  const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, o.workspaceId), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
  const byId = members.find((m) => m.id === w);
  if (byId) {
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, byId.userId) });
    return user ? { membership: byId, user } : null;
  }
  const users = members.length ? await db.query.users.findMany({ where: inArray(schema.users.id, members.map((m) => m.userId)) }) : [];
  const hits = users.filter((u) => u.name.toLowerCase() === w.toLowerCase() || u.name.split(" ")[0].toLowerCase() === w.toLowerCase());
  if (hits.length !== 1) return null;
  const membership = members.find((m) => m.userId === hits[0].id)!;
  return { membership, user: hits[0] };
}

/**
 * The viewer an agent token acts as while switched in: the client's own HelixOS, with the coach as the actor, work when
 * the client lets their coach work and view otherwise, HumanOS hidden, exactly as the coach's own switch (src/lib/auth.ts).
 * Null when the grant is gone or the client is: the caller then clears the switch and falls back to the coach's own viewer.
 */
export async function switchedViewerFor(own: Viewer, agentId: string, clientMembershipId: string): Promise<Viewer | null> {
  if (own.role !== "coach") return null;
  const o = { workspaceId: own.workspace.id, userId: own.user.id };
  if (!(await liveGrant(o, agentId, clientMembershipId))) return null;
  const cm = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, clientMembershipId), eq(schema.memberships.workspaceId, own.workspace.id)) });
  if (!cm || cm.role !== "client" || cm.removedAt) return null;
  const cu = await db.query.users.findFirst({ where: eq(schema.users.id, cm.userId) });
  if (!cu) return null;
  const ctz = cm.timezone || own.workspace.timezone;
  return {
    user: cu,
    workspace: own.workspace,
    membership: { ...cm, bodyEnabled: false },
    role: "client",
    tz: ctz,
    today: todayInTz(ctz),
    hour: hourInTz(ctz),
    actor: own.user,
    switchedInto: { membershipId: cm.id, mode: cm.coachCanWork ? "work" : "view", clientName: cu.name, coachName: own.user.name, canWork: cm.coachCanWork },
    team: null,
  };
}

/** client_switch: the connection now acts as the client; recorded for the client and on the coach's client page. */
export async function switchInto(own: Viewer, appId: string, agentId: string, clientMembershipId: string): Promise<Viewer | null> {
  const v = await switchedViewerFor(own, agentId, clientMembershipId);
  if (!v) return null;
  await db.update(schema.connectedApps).set({ switchedMembershipId: clientMembershipId }).where(eq(schema.connectedApps.id, appId));
  await db.insert(schema.coachChanges).values({ id: newId(), workspaceId: own.workspace.id, clientMembershipId, userId: v.user.id, coachUserId: own.user.id, agentId, kind: "switch_in", mode: v.switchedInto!.mode });
  return v;
}

/** client_switch_off, or a grant that ended: back to the coach's own HelixOS. */
export async function switchOut(own: Viewer, appId: string, agentId: string, switched: Viewer | null): Promise<void> {
  await db.update(schema.connectedApps).set({ switchedMembershipId: null }).where(eq(schema.connectedApps.id, appId));
  if (switched?.switchedInto) await db.insert(schema.coachChanges).values({ id: newId(), workspaceId: own.workspace.id, clientMembershipId: switched.switchedInto.membershipId, userId: switched.user.id, coachUserId: own.user.id, agentId, kind: "switch_out", mode: switched.switchedInto.mode });
}

/** A write the agent made as the client, in the client's own record: "Added a task · on Today · by Hospes (Danno's agent)". */
export async function recordAgentChange(switched: Viewer, agentId: string, tool: string): Promise<void> {
  const sw = switched.switchedInto;
  if (!sw) return;
  const { action, page } = changeWords(tool);
  await db.insert(schema.coachChanges).values({ id: newId(), workspaceId: switched.workspace.id, clientMembershipId: sw.membershipId, userId: switched.user.id, coachUserId: switched.actor.id, agentId, kind: "change", mode: "work", action, page, item: null });
}

/** The agents' switches in and out of one client, newest first, for the coach's client page. */
export async function agentSwitchesFor(o: Owner, clientMembershipId: string, limit = 20) {
  return db.query.coachChanges.findMany({ where: and(eq(schema.coachChanges.clientMembershipId, clientMembershipId), eq(schema.coachChanges.coachUserId, o.userId), inArray(schema.coachChanges.kind, ["switch_in", "switch_out"])), orderBy: [desc(schema.coachChanges.createdAt)], limit: limit * 3 }).then((rows) => rows.filter((r) => r.agentId).slice(0, limit));
}
