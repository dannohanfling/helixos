/**
 * Office Hours by program level (H-470), the server side: one read that the layout (the menu item), Today (the door and the
 * notice), the Office Hours page, the booking action and the connector's two tools all share. The rule itself is
 * `oohAccess` in src/lib/engine/office-hours.ts. A team member gets the owner's answer, because the viewer's membership is the
 * owner's (H-413); a coach switched into a client gets the client's.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { oohAccess, type OohAccess } from "@/lib/engine/office-hours";

/** The fulfilled access claims for one member, as the rule reads them. */
export async function oohClaimsFor(workspaceId: string, userId: string) {
  return db.query.rewardClaims.findMany({ where: and(eq(schema.rewardClaims.workspaceId, workspaceId), eq(schema.rewardClaims.userId, userId), eq(schema.rewardClaims.status, "fulfilled")), columns: { rewardName: true, status: true, fulfilledAt: true } });
}

/** Whether the viewer's account has Office Hours today, and why. */
export async function oohAccessFor(v: Viewer): Promise<OohAccess> {
  if (v.role === "coach") return oohAccess({ role: "coach", programTier: v.membership.programTier, officeHoursOverride: v.membership.officeHoursOverride }, [], v.today);
  const claims = await oohClaimsFor(v.workspace.id, v.user.id);
  return oohAccess({ role: v.role, programTier: v.membership.programTier, officeHoursOverride: v.membership.officeHoursOverride }, claims, v.today);
}

/** The same read for one of the coach's clients, by membership. */
export async function oohAccessOf(m: { workspaceId: string; userId: string; role: string; programTier: string; officeHoursOverride: "on" | "off" | null }, today: string): Promise<OohAccess> {
  const claims = m.role === "coach" ? [] : await oohClaimsFor(m.workspaceId, m.userId);
  return oohAccess(m, claims, today);
}
