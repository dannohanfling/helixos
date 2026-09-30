import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { readSession } from "@/lib/session";
import { hourInTz, todayInTz } from "@/lib/dates";

export type Viewer = {
  user: schema.User;
  workspace: schema.Workspace;
  membership: schema.Membership;
  role: "coach" | "client";
  /** The member's own timezone, or the workspace's. Every "today" in the app comes from this. */
  tz: string;
  today: string;
  hour: number;
  /** The person signed in: the viewer's own user, or, while switched, the coach acting in a client's HelixOS. */
  actor: schema.User;
  /**
   * "Switch to client" (rev 216): set only while a coach is in a client's HelixOS. Then `user`, `membership` and `role` are
   * the client's, so every page shows the client's own HelixOS, and `actor` is the coach. Null otherwise. Anything the coach
   * must never do as the client (consent, secrets, exports, sends, streaks, points, Body) checks this.
   */
  switchedInto: Switched | null;
};

export type Switched = { membershipId: string; mode: "view" | "work"; clientName: string; coachName: string };

/** Resolves the signed-in viewer once per request. */
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
  return { user, workspace, membership, role: membership.role, tz, today: todayInTz(tz), hour: hourInTz(tz), actor: user, switchedInto: null };
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await readSession();
  if (!session) return null;
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
  };
});

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) {
    // A removed member holds a valid session but no membership access: send them to the plain "access ended" page, not /login.
    const session = await readSession();
    if (session) {
      const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, session.userId), eq(schema.memberships.workspaceId, session.workspaceId)) });
      if (m?.removedAt) redirect("/removed");
    }
    // A cookie that no longer verifies (password changed elsewhere, user gone) must be cleared, or /login bounces straight back here.
    redirect(session ? "/api/session/clear" : "/login");
  }
  return v;
}

export async function requireCoach(): Promise<Viewer> {
  const v = await requireViewer();
  if (v.role !== "coach") redirect("/today");
  return v;
}
