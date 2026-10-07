import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { readSession } from "@/lib/session";
import { hourInTz, nowIso, todayInTz } from "@/lib/dates";

export type Viewer = {
  user: schema.User;
  workspace: schema.Workspace;
  membership: schema.Membership;
  role: "coach" | "client";
  /** The member's own timezone, or the workspace's. Every "today" in the app comes from this. */
  tz: string;
  today: string;
  hour: number;
  /** The person signed in: the viewer's own user, or, while switched or on a team, the person acting in a member's HelixOS. */
  actor: schema.User;
  /**
   * "Switch to client" (rev 216): set only while a coach is in a client's HelixOS. Then `user`, `membership` and `role` are
   * the client's, so every page shows the client's own HelixOS, and `actor` is the coach. Null otherwise. Anything the coach
   * must never do as the client (consent, secrets, exports, sends, streaks, points, Body) checks this.
   */
  switchedInto: Switched | null;
  /**
   * Team access (Danno, 6 Oct): set while a team member works in the owner's HelixOS through their own login. `user`,
   * `membership` and `role` are the owner's (role always "client": a team member is never a coach), `actor` is the team
   * member. Null otherwise. Everything a team member may not reach (Body, billing, integrations, connections, the team itself,
   * the owner's own day) is closed by default: a page or API route opens with `requireViewer({ team: "allow" })` and an action
   * with `ctx({ team: "allow" })`, and src/lib/engine/__tests__/team.test.ts holds the list of what is open.
   */
  team: Team | null;
};

export type Switched = { membershipId: string; mode: "view" | "work"; clientName: string; coachName: string };
export type Team = { teamMemberId: string; ownerMembershipId: string; ownerName: string; teamName: string };
/** Whether a guard admits a team member. The default is no. */
export type TeamAccess = { team?: "allow" };

/**
 * The viewer for one member of one workspace, as themselves: what a session cookie resolves to, and what a connected app's
 * token (the MCP server) resolves to. A removed member has no access: every guard denies uniformly. No session version here:
 * that check belongs to cookies, and a password change keeps connected apps (rev 247, B4).
 */
export async function viewerFor(userId: string, workspaceId: string): Promise<Viewer | null> {
  const membership = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, userId), eq(schema.memberships.workspaceId, workspaceId)) });
  if (!membership) return null;
  if (membership.removedAt) return null;
  const [user, workspace] = await Promise.all([db.query.users.findFirst({ where: eq(schema.users.id, userId) }), db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) })]);
  if (!user || !workspace) return null;
  const tz = membership.timezone || workspace.timezone;
  return { user, workspace, membership, role: membership.role, tz, today: todayInTz(tz), hour: hourInTz(tz), actor: user, switchedInto: null, team: null };
}

/**
 * The viewer a team member's session resolves to: the owner's HelixOS, with the team member as the actor. Null once the
 * team row is removed, or the owner is removed or gone: access ends on the next request, whatever the cookie says. Body is
 * never visible to a team member, whatever the owner's own flag says.
 */
export async function teamViewerFor(teamUserId: string, teamMemberId: string): Promise<Viewer | null> {
  const tm = await db.query.teamMembers.findFirst({ where: and(eq(schema.teamMembers.id, teamMemberId), eq(schema.teamMembers.teamUserId, teamUserId)) });
  if (!tm || tm.removedAt) return null;
  const owner = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, tm.ownerMembershipId), eq(schema.memberships.workspaceId, tm.workspaceId)) });
  if (!owner || owner.removedAt) return null;
  const [actor, user, workspace] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, teamUserId) }),
    db.query.users.findFirst({ where: eq(schema.users.id, owner.userId) }),
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, tm.workspaceId) }),
  ]);
  if (!actor || !user || !workspace) return null;
  const tz = owner.timezone || workspace.timezone;
  return {
    user,
    workspace,
    membership: { ...owner, bodyEnabled: false },
    role: "client",
    tz,
    today: todayInTz(tz),
    hour: hourInTz(tz),
    actor,
    switchedInto: null,
    team: { teamMemberId: tm.id, ownerMembershipId: owner.id, ownerName: user.name, teamName: actor.name },
  };
}

/** "Last active" on the team list, to the hour: stamped on the first request of each hour, never awaited by the page. */
async function touchTeamActivity(teamMemberId: string): Promise<void> {
  const tm = await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, teamMemberId), columns: { lastActiveAt: true } });
  if (tm?.lastActiveAt && Date.now() - Date.parse(tm.lastActiveAt) < 60 * 60 * 1000) return;
  await db.update(schema.teamMembers).set({ lastActiveAt: nowIso() }).where(eq(schema.teamMembers.id, teamMemberId));
}

/** Resolves the signed-in viewer once per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await readSession();
  if (!session) return null;
  if (session.tm) {
    // A team member's sign-in: their own account and session version, the owner's HelixOS.
    const tv = await teamViewerFor(session.userId, session.tm);
    if (!tv) return null;
    if ((session.sv ?? 0) !== tv.actor.sessionVersion) return null;
    touchTeamActivity(session.tm).catch(() => undefined);
    return tv;
  }
  const own = await viewerFor(session.userId, session.workspaceId);
  if (!own) return null;
  const { user, workspace, membership } = own;
  if ((session.sv ?? 0) !== user.sessionVersion) return null;
  if (!session.sw || membership.role !== "coach") return own;
  // Switched into a client: checked on every request, not only at the switch. A client that is gone, removed, a coach, or in
  // another workspace ends the switch (the coach is simply back in their own account).
  const cm = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, session.sw.m), eq(schema.memberships.workspaceId, workspace.id)) });
  if (!cm || cm.role !== "client" || cm.removedAt) return own;
  const cu = await db.query.users.findFirst({ where: eq(schema.users.id, cm.userId) });
  if (!cu) return own;
  // Work needs the client's "Let my coach work in my HelixOS"; switched off meanwhile, the coach is back to view at once.
  const mode = session.sw.mode === "work" && cm.coachCanWork ? "work" : "view";
  const ctz = cm.timezone || workspace.timezone;
  return {
    user: cu,
    workspace,
    // Body is never visible while switched, even when the client shares it (rev 216): Body's own flag hides it everywhere.
    membership: { ...cm, bodyEnabled: false },
    role: "client",
    tz: ctz,
    today: todayInTz(ctz),
    hour: hourInTz(ctz),
    actor: user,
    switchedInto: { membershipId: cm.id, mode, clientName: cu.name, coachName: user.name },
    team: null,
  };
});

/**
 * The viewer for a page. A team member reaches only a page that says `{ team: "allow" }`; every other page is not found to
 * them, the same answer a stranger gets, so nothing closed is even named.
 */
export async function requireViewer(opts: TeamAccess = {}): Promise<Viewer> {
  const v = await getViewer();
  if (!v) {
    // A removed member holds a valid session but no membership access: send them to the plain "access ended" page, not /login.
    const session = await readSession();
    if (session) {
      if (session.tm) {
        const tm = await db.query.teamMembers.findFirst({ where: and(eq(schema.teamMembers.id, session.tm), eq(schema.teamMembers.teamUserId, session.userId)) });
        if (tm?.removedAt) redirect("/removed");
      } else {
        const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, session.userId), eq(schema.memberships.workspaceId, session.workspaceId)) });
        if (m?.removedAt) redirect("/removed");
      }
    }
    // A cookie that no longer verifies (password changed elsewhere, user gone) must be cleared, or /login bounces straight back here.
    redirect(session ? "/api/session/clear" : "/login");
  }
  if (v.team && opts.team !== "allow") notFound();
  return v;
}

/**
 * The viewer for a route handler, which answers 401 or 404 itself: null without a session, and null to a team member unless the
 * route says `{ team: "allow" }`, so a closed route reads to them exactly as it does to a stranger.
 */
export async function apiViewer(opts: TeamAccess = {}): Promise<Viewer | null> {
  const v = await getViewer();
  if (!v) return null;
  if (v.team && opts.team !== "allow") return null;
  return v;
}

export async function requireCoach(): Promise<Viewer> {
  const v = await requireViewer();
  if (v.role !== "coach") redirect("/today");
  return v;
}
