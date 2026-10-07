"use server";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { hashSecret } from "@/lib/crypto";
import { inviteCode, newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { logSync } from "@/lib/integrations";
import { TEAM_INVITE_COOKIE, TEAM_IS_THEIRS, logTeamEvent, seatsLeft } from "@/lib/team";
import { inviteExpiry, readCap } from "@/lib/engine/team";

/**
 * Team access (Danno, 6 Oct). The owner invites and removes from Settings → Team; their coach sees the team on the client page,
 * removes from there and sets the seat cap. A team member reaches none of these: ctx() refuses them by default, and a switched
 * coach is refused too (the team is the client's own to manage; the client page is the coach's way in).
 */

/** A one-time link to join the owner's team: a 24-character code, only its hash stored, a week to use it, one use. */
export async function createTeamInviteAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: TEAM_IS_THEIRS });
  const seats = await seatsLeft(v.membership);
  if (seats.left <= 0) redirect("/settings?team=full#team");
  const label = str(formData, "label").slice(0, 80) || null;
  const code = inviteCode(24);
  await db.insert(schema.teamInvites).values({ id: newId(), workspaceId: v.workspace.id, ownerMembershipId: v.membership.id, userId: v.user.id, createdBy: v.actor.id, codeHash: hashSecret(code), label, expiresAt: inviteExpiry() });
  // The link is shown on the next Settings render and nowhere else: a short cookie carries it there, then it is gone.
  (await cookies()).set(TEAM_INVITE_COOKIE, code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 120, path: "/settings" });
  refresh();
  redirect("/settings?team=invited#team");
}

/** The owner cancels an invite that hasn't been used: the link stops working at once. */
export async function revokeTeamInviteAction(formData: FormData): Promise<void> {
  const { v, workspaceId } = await ctx({ whileSwitched: "refuse", reason: TEAM_IS_THEIRS });
  const id = str(formData, "inviteId");
  await db
    .update(schema.teamInvites)
    .set({ revokedAt: nowIso() })
    .where(and(eq(schema.teamInvites.id, id), eq(schema.teamInvites.workspaceId, workspaceId), eq(schema.teamInvites.ownerMembershipId, v.membership.id)));
  refresh();
  redirect("/settings?team=revoked#team");
}

/** The owner removes a team member: their access ends on their next request. The row stays for the log. */
export async function removeTeamMemberAction(formData: FormData): Promise<void> {
  const { v, workspaceId } = await ctx({ whileSwitched: "refuse", reason: TEAM_IS_THEIRS });
  const id = str(formData, "teamMemberId");
  const tm = await db.query.teamMembers.findFirst({ where: and(eq(schema.teamMembers.id, id), eq(schema.teamMembers.workspaceId, workspaceId), eq(schema.teamMembers.ownerMembershipId, v.membership.id)) });
  if (!tm || tm.removedAt) redirect("/settings#team");
  await db.update(schema.teamMembers).set({ removedAt: nowIso(), removedBy: v.actor.id }).where(eq(schema.teamMembers.id, tm.id));
  await logTeamEvent({ workspaceId, ownerMembershipId: tm.ownerMembershipId, userId: tm.userId, teamMemberId: tm.id, teamUserId: tm.teamUserId, kind: "removed", action: `Removed by ${v.actor.name}` });
  refresh();
  redirect("/settings?team=removed#team");
}

/** The coach removes one of a client's team members from the client page (Danno's answer 3). */
export async function coachRemoveTeamMemberAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const id = str(formData, "teamMemberId");
  const tm = await db.query.teamMembers.findFirst({ where: and(eq(schema.teamMembers.id, id), eq(schema.teamMembers.workspaceId, coach.workspace.id)) });
  if (!tm) redirect("/coach");
  if (tm.removedAt) redirect(`/coach/${tm.ownerMembershipId}#team`);
  await db.update(schema.teamMembers).set({ removedAt: nowIso(), removedBy: coach.user.id }).where(and(eq(schema.teamMembers.id, tm.id), eq(schema.teamMembers.workspaceId, coach.workspace.id)));
  await logTeamEvent({ workspaceId: coach.workspace.id, ownerMembershipId: tm.ownerMembershipId, userId: tm.userId, teamMemberId: tm.id, teamUserId: tm.teamUserId, kind: "removed", action: `Removed by ${coach.user.name} (coach)` });
  await logSync({ workspaceId: coach.workspace.id, userId: tm.userId, provider: "account", direction: "out", event: "team.removed", payload: { by: coach.user.name }, status: "sent", note: `Team member removed by ${coach.user.name}` });
  refresh();
  redirect(`/coach/${tm.ownerMembershipId}?team=removed#team`);
}

/** The coach sets how many team members a client may have (five by default). A number that isn't one keeps the old cap. */
export async function setTeamCapAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, coach.workspace.id), eq(schema.memberships.role, "client")) });
  if (!m) redirect("/coach");
  const cap = readCap(str(formData, "cap"), m.teamCap);
  if (cap !== m.teamCap) {
    await db.update(schema.memberships).set({ teamCap: cap }).where(and(eq(schema.memberships.id, m.id), eq(schema.memberships.workspaceId, coach.workspace.id)));
    await logSync({ workspaceId: coach.workspace.id, userId: m.userId, provider: "account", direction: "out", event: "team.cap", payload: { by: coach.user.name, from: m.teamCap, to: cap }, status: "sent", note: `Team seats set to ${cap} by ${coach.user.name}` });
  }
  refresh();
  redirect(`/coach/${m.id}?team=cap#team`);
}
