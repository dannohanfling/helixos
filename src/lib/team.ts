import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { actionId, actionName, refuseSwitched, whereFrom } from "@/lib/switch";
import { actionWords } from "@/lib/engine/switch";
import { TEAM_REFUSAL } from "@/lib/engine/team";

/**
 * Team access (Danno, 6 Oct), on the server: every write a team member makes in the owner's HelixOS passes through here from
 * ctx(). An action that has not said `team: "allow"` is refused with the reason beside the form; an allowed one is logged for
 * the owner in plain words, one row per request, as a switched coach's is (src/lib/switch.ts). "noop" is for a read-state
 * side effect the caller skips itself.
 */
export type TeamWrite = "allow" | "refuse" | "noop";

/** Sends the team member back to the page they were on, with the reason. Never returns. */
export async function refuseTeam(reason = TEAM_REFUSAL): Promise<never> {
  return refuseSwitched(reason);
}

/** One log row per request: an action that calls ctx() twice is still one change. */
const loggedThisRequest = cache(() => ({ done: false }));

export async function teamWrite(v: Viewer, how: TeamWrite): Promise<void> {
  const t = v.team;
  if (!t || how === "noop") return;
  if (how === "refuse") await refuseTeam();
  const once = loggedThisRequest();
  if (once.done) return;
  once.done = true;
  const [{ page, item }, id] = await Promise.all([whereFrom(v), actionId()]);
  await logTeam({ v, kind: "change", action: actionWords(actionName(id)), page, item });
}

/** A row on the owner's team log: a change, a sign-in, a join, a removal. */
export async function logTeam(input: { v: Viewer; kind: schema.TeamChange["kind"]; action?: string | null; page?: string | null; item?: string | null }): Promise<void> {
  const t = input.v.team;
  if (!t) return;
  await db.insert(schema.teamChanges).values({ id: newId(), workspaceId: input.v.workspace.id, ownerMembershipId: t.ownerMembershipId, userId: input.v.user.id, teamMemberId: t.teamMemberId, teamUserId: input.v.actor.id, kind: input.kind, action: input.action ?? null, page: input.page ?? null, item: input.item ?? null });
}

/** A row on the owner's team log written by the owner or their coach (a removal), outside a team member's request. */
export async function logTeamEvent(input: { workspaceId: string; ownerMembershipId: string; userId: string; teamMemberId: string; teamUserId: string; kind: schema.TeamChange["kind"]; action?: string | null }): Promise<void> {
  await db.insert(schema.teamChanges).values({ id: newId(), ...input, action: input.action ?? null });
}

export type TeamRow = { member: schema.TeamMember; name: string; email: string; addedByName: string };

/** The owner's live team, newest first, with each person's name and who added them. */
export async function teamOf(ownerMembershipId: string): Promise<TeamRow[]> {
  const rows = await db.query.teamMembers.findMany({ where: and(eq(schema.teamMembers.ownerMembershipId, ownerMembershipId), isNull(schema.teamMembers.removedAt)), orderBy: [desc(schema.teamMembers.createdAt)] });
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.teamUserId, r.addedBy]))];
  const users = new Map((await db.query.users.findMany({ where: inArray(schema.users.id, ids) })).map((u) => [u.id, u]));
  return rows.map((member) => ({ member, name: users.get(member.teamUserId)?.name ?? "Someone", email: users.get(member.teamUserId)?.email ?? "", addedByName: users.get(member.addedBy)?.name ?? "someone" }));
}

/** The owner's open invites: not used, not revoked, not past their week. */
export async function openInvites(ownerMembershipId: string): Promise<schema.TeamInvite[]> {
  return db.query.teamInvites.findMany({ where: and(eq(schema.teamInvites.ownerMembershipId, ownerMembershipId), isNull(schema.teamInvites.usedAt), isNull(schema.teamInvites.revokedAt), gt(schema.teamInvites.expiresAt, nowIso())), orderBy: [desc(schema.teamInvites.createdAt)] });
}

/** How many seats an owner has left: the cap less live members and open invites. */
export async function seatsLeft(owner: Pick<schema.Membership, "id" | "teamCap">): Promise<{ cap: number; members: number; invites: number; left: number }> {
  const [members, invites] = await Promise.all([teamOf(owner.id), openInvites(owner.id)]);
  return { cap: owner.teamCap, members: members.length, invites: invites.length, left: Math.max(0, owner.teamCap - members.length - invites.length) };
}

/** Every HelixOS a person may sign in to: their own memberships (coach first, then by start) and the teams they are on, live only. */
export type Choice = { key: string; kind: "own" | "team"; label: string; sub: string; workspaceId: string; role: "coach" | "client" };
export async function choicesFor(userId: string): Promise<Choice[]> {
  const own = await db.query.memberships.findMany({ where: and(eq(schema.memberships.userId, userId), isNull(schema.memberships.removedAt)) });
  const teams = await db.query.teamMembers.findMany({ where: and(eq(schema.teamMembers.teamUserId, userId), isNull(schema.teamMembers.removedAt)) });
  const wsIds = [...new Set([...own.map((m) => m.workspaceId), ...teams.map((t) => t.workspaceId)])];
  const workspaces = new Map(wsIds.length ? (await db.query.workspaces.findMany({ where: inArray(schema.workspaces.id, wsIds) })).map((w) => [w.id, w]) : []);
  const owners = teams.length ? await db.query.memberships.findMany({ where: inArray(schema.memberships.id, teams.map((t) => t.ownerMembershipId)) }) : [];
  const ownerUsers = new Map(owners.length ? (await db.query.users.findMany({ where: inArray(schema.users.id, owners.map((o) => o.userId)) })).map((u) => [u.id, u]) : []);
  const out: Choice[] = [];
  for (const m of [...own].sort((a, b) => (a.role === b.role ? a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id) : a.role === "coach" ? -1 : 1))) {
    const w = workspaces.get(m.workspaceId);
    if (!w) continue;
    out.push({ key: `m:${m.id}`, kind: "own", label: m.businessName?.trim() || w.name, sub: m.role === "coach" ? `your workspace, ${w.name}` : `your HelixOS in ${w.name}`, workspaceId: w.id, role: m.role });
  }
  for (const t of [...teams].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    const o = owners.find((x) => x.id === t.ownerMembershipId);
    const w = workspaces.get(t.workspaceId);
    if (!o || o.removedAt || !w) continue;
    const ou = ownerUsers.get(o.userId);
    out.push({ key: `t:${t.id}`, kind: "team", label: `${ou?.name ?? "A member"}'s team`, sub: `${o.businessName?.trim() || w.name}, as a team member`, workspaceId: w.id, role: "client" });
  }
  return out;
}

/** The cookie an invite leaves for the owner's next Settings render: the link, shown once, gone in two minutes. Never a log line, never the database. */
export const TEAM_INVITE_COOKIE = "helix_team_invite";

/** How an owner's refused team action reads to a coach switched into their HelixOS. */
export const TEAM_IS_THEIRS = "{first}'s team is theirs to manage. Remove a team member from their client page, or ask them to.";
