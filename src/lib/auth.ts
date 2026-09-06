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
  today: string;
  hour: number;
};

/** Resolves the signed-in viewer once per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await readSession();
  if (!session) return null;
  const membership = await db.query.memberships.findFirst({
    where: and(eq(schema.memberships.userId, session.userId), eq(schema.memberships.workspaceId, session.workspaceId)),
  });
  if (!membership) return null;
  const [user, workspace] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, session.userId) }),
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, session.workspaceId) }),
  ]);
  if (!user || !workspace) return null;
  return {
    user,
    workspace,
    membership,
    role: membership.role,
    today: todayInTz(workspace.timezone),
    hour: hourInTz(workspace.timezone),
  };
});

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect("/login");
  return v;
}

export async function requireCoach(): Promise<Viewer> {
  const v = await requireViewer();
  if (v.role !== "coach") redirect("/today");
  return v;
}
